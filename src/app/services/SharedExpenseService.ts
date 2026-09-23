import {
  SharedExpense,
  SharedSplit,
} from "../../domain/entities/SharedExpense";
import { SharedGroup } from "../../domain/entities/SharedGroup";
import { Transaction } from "../../domain/entities/Transaction";
import { ISharedExpenseRepository } from "../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import { ISharedGroupRepository } from "../../domain/repositories/sharedGroup/ISharedGroupRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { createOrReplay, CreateOutcome } from "../../shared/clientMintedId";
import { assertFresh, guardedWrite } from "../../shared/concurrency";
import {
  SHARED_HISTORY_REASONS,
  TRANSACTION_TYPES,
} from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";
import { ApiError } from "../../shared/errors";
import { assertAmountPrecision } from "../../shared/money";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { TxSession, withTransaction } from "../../shared/unitOfWork";
import {
  CreateSharedExpenseDTO,
  SplitDTO,
  UpdateSharedExpenseDTO,
} from "../dtos/SharedExpenseDTO";
import { stampSharedChange } from "./sharedLedger";
import { counterpartiesOf, SharedLedgerService } from "./SharedLedgerService";
import { buildSplit, inheritedSplit, statedSplitOf } from "./sharedSplitting";

/** What the expense is worth, wherever the figures came from. */
interface ExpenseFigures {
  amount: number;
  date: Date;
  description: string | null;
}

const required = <T>(value: T | undefined, field: string): T => {
  if (value === undefined) {
    throw new ApiError(
      "BadRequest",
      `${field} is required unless the expense is a movement of yours`,
      "VALIDATION",
    );
  }
  return value;
};

export class SharedExpenseService {
  constructor(
    private repo: ISharedExpenseRepository,
    private groupRepo: ISharedGroupRepository,
    private transactionRepo: ITransactionRepository,
    private ledger: SharedLedgerService,
  ) {}

  private async groupOfTheirs(
    groupId: string,
    userId: string,
  ): Promise<SharedGroup> {
    const group = await this.groupRepo.getByIdIncludingArchived(groupId);
    if (!group || group.userId !== userId) {
      throw new ApiError("NotFound", "Shared group not found");
    }
    return new SharedGroup(group);
  }

  private async liveGroup(
    groupId: string,
    userId: string,
  ): Promise<SharedGroup> {
    const group = await this.groupOfTheirs(groupId, userId);
    if (group.archivedAt) {
      throw new ApiError(
        "BadRequest",
        "Shared group is archived; restore it first",
        "RESOURCE_ARCHIVED",
      );
    }
    return group;
  }

  private assertPayerIsInTheGroup(
    group: SharedGroup,
    paidByContactId: string | null,
  ): void {
    if (paidByContactId === null) return;
    if (
      !group.participants.some(
        (participant) => participant.contactId === paidByContactId,
      )
    ) {
      throw new ApiError(
        "BadRequest",
        "Whoever paid has to be in the shared group",
        "PARTICIPANT_NOT_IN_GROUP",
      );
    }
  }

  private assertPrecision(
    amount: number,
    split: SplitDTO | undefined,
    currency: string,
  ): void {
    assertAmountPrecision(amount, currency, "amount");
    for (const share of split?.shares ?? []) {
      if (share.fixedAmount !== undefined && share.fixedAmount !== null) {
        assertAmountPrecision(
          share.fixedAmount,
          currency,
          "split.shares.fixedAmount",
        );
      }
    }
  }

  private splitFor(input: {
    group: SharedGroup;
    split: SplitDTO | undefined;
    amount: number;
    currency: string;
    paidByContactId: string | null;
  }): SharedSplit {
    const { group, split, amount, currency, paidByContactId } = input;
    return split
      ? buildSplit({
          split,
          participants: group.participants,
          amount,
          currency,
          paidByContactId,
        })
      : inheritedSplit({ group, amount, currency, paidByContactId });
  }

  async getExpenses(
    userId: string,
    groupId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedExpense>> {
    // A group of somebody else's must not be listable through its expenses either.
    await this.groupOfTheirs(groupId, userId);
    const result = await this.repo.getAllByGroup(userId, groupId, pagination);
    return {
      data: result.data.map((expense) => new SharedExpense(expense)),
      pagination: result.pagination,
    };
  }

  // Reads resolve deleted expenses too; only the listing hides them.
  async getExpenseById(
    id: string,
    userId: string,
    groupId?: string,
  ): Promise<SharedExpense> {
    const expense = await this.repo.getByIdIncludingDeleted(id);
    if (
      !expense ||
      expense.userId !== userId ||
      (groupId !== undefined && expense.groupId !== groupId)
    ) {
      throw new ApiError("NotFound", "Shared expense not found");
    }
    return new SharedExpense(expense);
  }

  async createExpense(
    dto: CreateSharedExpenseDTO,
    outcome?: CreateOutcome,
  ): Promise<SharedExpense> {
    return createOrReplay({
      clientId: dto.id,
      outcome,
      findOwn: (id) => this.repo.getOwnById(id, dto.userId),
      replay: async (expense) => new SharedExpense(expense),
      create: () => this.insertExpense(dto),
    });
  }

  private async insertExpense(
    dto: CreateSharedExpenseDTO,
  ): Promise<SharedExpense> {
    const transactionId = dto.transactionId;
    if (transactionId === undefined) {
      return withTransaction(async (session) => {
        const group = await this.liveGroup(dto.groupId, dto.userId);
        const expense = this.buildExpense(dto, group, {
          amount: required(dto.amount, "amount"),
          date: required(dto.date, "date"),
          description: dto.description ?? null,
        });
        const created = new SharedExpense(
          await this.repo.create(expense, session),
        );
        await this.reimpute(created, session);
        return created;
      });
    }

    // The movement states the figures, so linking it and writing them cannot leave two versions.
    return withTransaction(async (session) => {
      const group = await this.liveGroup(dto.groupId, dto.userId);
      const transaction = await this.splittableTransaction(
        transactionId,
        dto.userId,
        group.currency ?? DEFAULT_CURRENCY,
        session,
      );
      const expense = this.buildExpense(dto, group, {
        amount: transaction.amount,
        date: transaction.date,
        description: transaction.description,
      });
      const created = await this.repo.create(expense, session);
      await stampSharedChange(
        this.transactionRepo,
        session,
        transaction,
        SHARED_HISTORY_REASONS.SPLIT,
        { sharedExpenseId: created.id, sharedGroupId: group.id },
      );
      await this.reimpute(new SharedExpense(created), session);
      return new SharedExpense(created);
    });
  }

  private buildExpense(
    dto: CreateSharedExpenseDTO,
    group: SharedGroup,
    figures: ExpenseFigures,
  ): SharedExpense {
    const currency = group.currency ?? DEFAULT_CURRENCY;
    const paidByContactId = dto.paidByContactId ?? null;
    this.assertPayerIsInTheGroup(group, paidByContactId);
    this.assertPrecision(figures.amount, dto.split, currency);

    const expense = new SharedExpense({
      id: dto.id,
      groupId: dto.groupId,
      description: figures.description,
      date: figures.date,
      amount: figures.amount,
      paidByContactId,
      split: this.splitFor({
        group,
        split: dto.split,
        amount: figures.amount,
        currency,
        paidByContactId,
      }),
      customSplit: Boolean(dto.split),
      userId: dto.userId,
      currency,
    });
    expense.assertValid();
    return expense;
  }

  /** Read inside the write's own transaction: two requests cannot both take the same movement. */
  private async splittableTransaction(
    transactionId: string,
    userId: string,
    currency: string,
    session: TxSession,
  ): Promise<Transaction> {
    const transaction = await this.transactionRepo.getById(
      transactionId,
      session,
    );
    if (!transaction || transaction.userId !== userId) {
      throw new ApiError("NotFound", "Transaction not found");
    }
    if (transaction.type !== TRANSACTION_TYPES.EXPENSE) {
      throw new ApiError(
        "BadRequest",
        "Only an expense can be split with other people",
        "TRANSACTION_NOT_SPLITTABLE",
      );
    }
    if (transaction.importedFromExpenseId) {
      throw new ApiError(
        "BadRequest",
        "That expense is already your part of a group shared with you",
        "TRANSACTION_NOT_SPLITTABLE",
      );
    }
    if (transaction.sharedExpenseId) {
      throw new ApiError(
        "BadRequest",
        "That movement is already in a shared group",
        "TRANSACTION_ALREADY_SHARED",
      );
    }
    if (transaction.currency && transaction.currency !== currency) {
      throw new ApiError(
        "BadRequest",
        "The movement and the shared group are in different currencies",
        "CURRENCY_MISMATCH",
      );
    }
    return transaction;
  }

  async updateExpense(
    id: string,
    dto: UpdateSharedExpenseDTO,
    userId: string,
    expectedUpdatedAt?: Date,
    groupId?: string,
  ): Promise<SharedExpense> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Shared expense id does not match");
    }
    if (dto.split && dto.useGroupSplit) {
      throw new ApiError(
        "BadRequest",
        "An expense either carries its own split or follows the group's",
        "SPLIT_INVALID",
      );
    }
    const existing = await this.getExpenseById(id, userId, groupId);
    assertFresh(existing, expectedUpdatedAt, (e) => new SharedExpense(e));
    if (existing.deletedAt) {
      throw new ApiError(
        "BadRequest",
        "Shared expense is deleted",
        "RESOURCE_ARCHIVED",
      );
    }
    const linked = await this.transactionRepo.getBySharedExpenseId(userId, id);
    if (linked) this.assertOnlyTheSplitChanges(dto);

    const group = await this.liveGroup(existing.groupId, userId);
    const currency = group.currency ?? DEFAULT_CURRENCY;
    const amount = dto.amount ?? existing.amount;
    const paidByContactId =
      dto.paidByContactId !== undefined
        ? dto.paidByContactId
        : existing.paidByContactId;
    this.assertPayerIsInTheGroup(group, paidByContactId);
    this.assertPrecision(amount, dto.split, currency);

    const merged = new SharedExpense({
      ...existing,
      description:
        dto.description !== undefined ? dto.description : existing.description,
      date: dto.date ?? existing.date,
      amount,
      paidByContactId,
      split: existing.split,
      customSplit: existing.customSplit,
    });
    merged.assertValid();

    const write: Partial<SharedExpense> = {
      description: merged.description,
      date: merged.date,
      amount: merged.amount,
      paidByContactId: merged.paidByContactId,
    };
    // Any of the three moves the figures, so the split is resolved again rather than left stale.
    const resplit =
      dto.split !== undefined ||
      dto.useGroupSplit === true ||
      dto.amount !== undefined ||
      dto.paidByContactId !== undefined;
    if (resplit) {
      const stated =
        dto.split ??
        (existing.customSplit && !dto.useGroupSplit
          ? statedSplitOf(existing.split)
          : undefined);
      write.split = this.splitFor({
        group,
        split: stated,
        amount,
        currency,
        paidByContactId,
      });
      write.customSplit = stated !== undefined;
    }

    return guardedWrite(
      expectedUpdatedAt,
      async () =>
        linked && resplit
          ? withTransaction(async (session) => {
              const saved = await this.repo.update(
                id,
                write,
                session,
                expectedUpdatedAt,
              );
              const { stamped } = await this.ledger.recompute(
                userId,
                counterpartiesOf(new SharedExpense(saved)),
                SHARED_HISTORY_REASONS.SPLIT_EDITED,
                session,
              );
              // Read again inside the write: a delete in between would otherwise be undone here.
              const movement = await this.transactionRepo.getBySharedExpenseId(
                userId,
                id,
                session,
              );
              if (movement && !stamped.has(id)) {
                await stampSharedChange(
                  this.transactionRepo,
                  session,
                  movement,
                  SHARED_HISTORY_REASONS.SPLIT_EDITED,
                );
              }
              return new SharedExpense(saved);
            })
          : new SharedExpense(
              await this.repo.update(id, write, undefined, expectedUpdatedAt),
            ),
      () => this.repo.getOwnById(id, userId),
      (e) => new SharedExpense(e),
    );
  }

  // Anything that changes what a line is worth imputes its people's payments over it again.
  private async reimpute(
    expense: SharedExpense,
    session: TxSession,
  ): Promise<void> {
    await this.ledger.recompute(
      expense.userId,
      counterpartiesOf(expense),
      SHARED_HISTORY_REASONS.REIMPUTED,
      session,
    );
  }

  /** The movement states the amount, the date and the description; the group states the split. */
  private assertOnlyTheSplitChanges(dto: UpdateSharedExpenseDTO): void {
    const restated =
      dto.amount !== undefined ||
      dto.date !== undefined ||
      dto.description !== undefined ||
      dto.paidByContactId !== undefined;
    if (restated) {
      throw new ApiError(
        "BadRequest",
        "This expense is a movement of yours: change its amount, date or description on the transaction",
        "SHARED_EXPENSE_LINKED",
      );
    }
  }

  // Idempotent, and it answers the deleted row so a queued write can guard on its updatedAt.
  async deleteExpense(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
    groupId?: string,
  ): Promise<SharedExpense> {
    const existing = await this.getExpenseById(id, userId, groupId);
    assertFresh(existing, expectedUpdatedAt, (e) => new SharedExpense(e));
    if (existing.deletedAt) {
      return new SharedExpense(existing);
    }
    return withTransaction(async (session) => {
      await this.ledger.assertNoGuestPayments(userId, id, session);
      const deleted = await this.repo.delete(id, session, expectedUpdatedAt);
      const linked = await this.transactionRepo.getBySharedExpenseId(
        userId,
        id,
        session,
      );
      if (linked) {
        await stampSharedChange(
          this.transactionRepo,
          session,
          linked,
          SHARED_HISTORY_REASONS.UNSPLIT,
          { sharedExpenseId: null, sharedGroupId: null },
        );
      }
      await this.reimpute(new SharedExpense(deleted), session);
      return new SharedExpense(deleted);
    });
  }
}
