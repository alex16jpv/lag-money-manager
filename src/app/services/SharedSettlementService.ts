import { SharedExpense } from "../../domain/entities/SharedExpense";
import {
  SettlementCounterparty,
  SharedSettlement,
} from "../../domain/entities/SharedSettlement";
import { IContactRepository } from "../../domain/repositories/contact/IContactRepository";
import { ISharedExpenseRepository } from "../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import {
  ISharedSettlementRepository,
  SettlementFilters,
} from "../../domain/repositories/sharedSettlement/ISharedSettlementRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { createOrReplay, CreateOutcome } from "../../shared/clientMintedId";
import { assertFresh } from "../../shared/concurrency";
import {
  SETTLEMENT_PARTIES,
  SHARE_PARTIES,
  SHARED_HISTORY_REASONS,
  TRANSACTION_TYPES,
} from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";
import { ApiError } from "../../shared/errors";
import { assertAmountPrecision } from "../../shared/money";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { TxSession, withTransaction } from "../../shared/unitOfWork";
import { CreateSharedSettlementDTO } from "../dtos/SharedSettlementDTO";
import {
  counterpartyKey,
  ShareChange,
  SharedLedgerService,
} from "./SharedLedgerService";
import { TransactionService } from "./TransactionService";

/** What a settle-up covered, line by line, so the screen can say it rather than leave it to be worked out. */
export interface SettlementCoverage {
  expenseId: string;
  description: string | null;
  date: Date;
  amount: number;
  direction: "COLLECTED" | "PAID";
}

export interface SettlementResult {
  settlement: SharedSettlement;
  covered: SettlementCoverage[];
  // What you handed over that covered no line: their money going back to them.
  refunded: number;
}

export class SharedSettlementService {
  constructor(
    private repo: ISharedSettlementRepository,
    private expenseRepo: ISharedExpenseRepository,
    private contactRepo: IContactRepository,
    private userRepo: IUserRepository,
    private ledger: SharedLedgerService,
    private transactions: TransactionService,
  ) {}

  async getSettlements(
    userId: string,
    pagination: PaginationParams,
    filters?: SettlementFilters,
  ): Promise<PaginatedResult<SharedSettlement>> {
    return this.repo.getAllByUserId(userId, pagination, filters);
  }

  async getSettlementById(
    id: string,
    userId: string,
  ): Promise<SharedSettlement> {
    const settlement = await this.repo.getOwnById(id, userId);
    if (!settlement) {
      throw new ApiError("NotFound", "Payment not found");
    }
    return settlement;
  }

  async createSettlement(
    dto: CreateSharedSettlementDTO,
    timezone: string,
    outcome?: CreateOutcome,
  ): Promise<SettlementResult> {
    return createOrReplay({
      clientId: dto.id,
      outcome,
      findOwn: (id) => this.repo.getOwnById(id, dto.userId),
      replay: async (settlement) => ({
        settlement,
        covered: [],
        refunded: 0,
      }),
      create: () => this.insert(dto, timezone),
    });
  }

  private async insert(
    dto: CreateSharedSettlementDTO,
    timezone: string,
  ): Promise<SettlementResult> {
    const collected = dto.collected ?? 0;
    const paid = dto.paid ?? 0;
    const outsideApp = dto.outsideApp ?? false;
    if (outsideApp && dto.accountId) {
      throw new ApiError(
        "BadRequest",
        "A payment outside the app touches no account of yours",
        "VALIDATION",
      );
    }
    if (!outsideApp && !dto.accountId) {
      throw new ApiError(
        "BadRequest",
        "accountId is required unless the payment was outside the app",
        "VALIDATION",
      );
    }

    return withTransaction(async (session) => {
      const currency = await this.currencyOf(dto.userId);
      assertAmountPrecision(collected, currency, "collected");
      assertAmountPrecision(paid, currency, "paid");
      const counterparty = await this.resolveCounterparty(dto, session);

      const settlement = new SharedSettlement({
        id: dto.id,
        userId: dto.userId,
        counterparty,
        date: dto.date,
        collected,
        paid,
        outsideApp,
        currency,
      });
      settlement.assertValid();
      const created = await this.repo.create(settlement, session);

      const { changes, surplus } = await this.ledger.recompute(
        dto.userId,
        [counterparty],
        SHARED_HISTORY_REASONS.PAYMENT,
        session,
      );
      const held = surplus.get(counterpartyKey(counterparty));
      if (held && held.yours > 0) {
        throw new ApiError(
          "BadRequest",
          "That is more than you owe them and more than they have paid ahead",
          "SETTLEMENT_OVER_PAID",
        );
      }

      const covered = this.coverageOf(changes);
      const yourLines = covered.filter((line) => line.direction === "PAID");
      const refunded = paid - yourLines.reduce((sum, l) => sum + l.amount, 0);
      if (!outsideApp) {
        await this.recordMovements(
          { dto, created, collected, refunded, yourLines, timezone },
          session,
        );
      }
      return { settlement: created, covered, refunded };
    });
  }

  private coverageOf(changes: ShareChange[]): SettlementCoverage[] {
    return changes
      .filter((change) => change.after > change.before)
      .map((change) => ({
        expenseId: change.expenseId,
        description: change.description,
        date: change.date,
        amount: change.after - change.before,
        direction:
          change.party === SHARE_PARTIES.USER
            ? ("PAID" as const)
            : ("COLLECTED" as const),
      }));
  }

  // One expense per line you cover, dated that line, so the categories come out exact.
  private async recordMovements(
    input: {
      dto: CreateSharedSettlementDTO;
      created: SharedSettlement;
      collected: number;
      refunded: number;
      yourLines: SettlementCoverage[];
      timezone: string;
    },
    session: TxSession,
  ): Promise<void> {
    const { dto, created, collected, refunded, yourLines, timezone } = input;
    const accountId = dto.accountId as string;
    const byLine = new Map(
      (dto.categories ?? []).map((one) => [one.expenseId, one.categoryId]),
    );

    if (collected > 0) {
      await this.transactions.recordWithin(
        {
          type: TRANSACTION_TYPES.SETTLEMENT,
          amount: collected,
          date: created.date,
          toAccountId: accountId,
          userId: dto.userId,
          sharedSettlementId: created.id,
        },
        timezone,
        session,
      );
    }

    for (const line of yourLines) {
      const categoryId = byLine.get(line.expenseId) ?? dto.categoryId;
      if (!categoryId) {
        throw new ApiError(
          "BadRequest",
          "Paying your share of a line is an expense of yours, so it needs a category",
          "VALIDATION",
        );
      }
      await this.transactions.recordWithin(
        {
          type: TRANSACTION_TYPES.EXPENSE,
          amount: line.amount,
          date: line.date,
          description: line.description,
          categoryId,
          fromAccountId: accountId,
          userId: dto.userId,
          sharedSettlementId: created.id,
        },
        timezone,
        session,
      );
    }

    if (refunded > 0) {
      await this.transactions.recordWithin(
        {
          type: TRANSACTION_TYPES.SETTLEMENT,
          amount: refunded,
          date: created.date,
          fromAccountId: accountId,
          userId: dto.userId,
          sharedSettlementId: created.id,
        },
        timezone,
        session,
      );
    }
  }

  /** Undoing a payment reverses what it recorded and imputes the rest over what is open again. */
  async deleteSettlement(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<SharedSettlement> {
    const existing = await this.getSettlementById(id, userId);
    assertFresh(existing, expectedUpdatedAt, (s) => s);
    if (existing.deletedAt) return existing;

    return withTransaction(async (session) => {
      const movements = await this.transactions.settlementMovements(
        userId,
        id,
        session,
      );
      for (const movement of movements) {
        await this.transactions.reverseWithin(movement, session);
      }
      const deleted = await this.repo.delete(id, session, expectedUpdatedAt);
      await this.ledger.recompute(
        userId,
        [existing.counterparty],
        SHARED_HISTORY_REASONS.REIMPUTED,
        session,
      );
      return deleted;
    });
  }

  private async currencyOf(userId: string): Promise<string> {
    const owner = await this.userRepo.getById(userId);
    return owner?.currency ?? DEFAULT_CURRENCY;
  }

  private async resolveCounterparty(
    dto: CreateSharedSettlementDTO,
    session: TxSession,
  ): Promise<SettlementCounterparty> {
    if (dto.contactId) {
      const contact = await this.contactRepo.getByIdIncludingArchived(
        dto.contactId,
      );
      if (!contact || contact.userId !== dto.userId) {
        throw new ApiError("NotFound", "Contact not found");
      }
      return {
        kind: SETTLEMENT_PARTIES.CONTACT,
        contactId: dto.contactId,
        expenseId: null,
      };
    }
    const expense = await this.liveExpense(
      dto.expenseId as string,
      dto.userId,
      session,
    );
    if (!expense.split.guests) {
      throw new ApiError(
        "BadRequest",
        "That expense has no block of guests to settle with",
        "VALIDATION",
      );
    }
    return {
      kind: SETTLEMENT_PARTIES.GUESTS,
      contactId: null,
      expenseId: expense.id,
    };
  }

  private async liveExpense(
    id: string,
    userId: string,
    session: TxSession,
  ): Promise<SharedExpense> {
    const expense = await this.expenseRepo.getById(id, session);
    if (!expense || expense.userId !== userId) {
      throw new ApiError("NotFound", "Shared expense not found");
    }
    return new SharedExpense(expense);
  }
}
