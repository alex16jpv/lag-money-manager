import { Transaction } from "../../domain/entities/Transaction";
import { DomainValidationError } from "../../domain/errors";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { IIdempotencyRepository } from "../../domain/repositories/idempotency/IIdempotencyRepository";
import {
  ITransactionRepository,
  TransactionFilters,
} from "../../domain/repositories/transaction/ITransactionRepository";
import { createOrReplay, CreateOutcome } from "../../shared/clientMintedId";
import { assertFresh } from "../../shared/concurrency";
import { dayKeyOf } from "../../shared/dayKey";
import { ErrorCode } from "../../shared/errorCodes";
import { ApiError } from "../../shared/errors";
import {
  PaginatedResult,
  PaginationParams,
  TransactionPagination,
} from "../../shared/pagination";
import { refuseMovement } from "../../shared/transactionRules";
import { TxSession, withTransaction } from "../../shared/unitOfWork";
import {
  CreateTransactionDTO,
  QuickAddTransactionDTO,
  UpdateTransactionDTO,
} from "../dtos/TransactionDTO";
import { Restamp, RestampJournal, WithRestamps } from "./restamps";
import { SharedLedgerService } from "./SharedLedgerService";

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === 11000
  );
}

// Scope in the stored key keeps future idempotent operations from colliding.
const TXN_CREATE_SCOPE = "txn-create";

export interface IdempotencyMeta {
  key: string;
  requestHash: string;
}

export interface BatchDetailUpdate {
  id: string;
  categoryId?: string | null;
  description?: string | null;
  pendingDetails?: boolean;
}

export interface BatchUpdateFailure {
  id: string;
  code: ErrorCode;
  message: string;
}

export interface BatchUpdateResult {
  updated: Transaction[];
  failed: BatchUpdateFailure[];
}

/** Expected, per-item failures become entries; anything else is a real fault. */
function describeItemFailure(
  id: string,
  err: unknown,
): BatchUpdateFailure | null {
  if (err instanceof DomainValidationError) {
    return { id, code: err.code ?? "VALIDATION", message: err.message };
  }
  if (err instanceof ApiError && err.statusCode < 500) {
    const code =
      err.code ?? (err.statusCode === 404 ? "NOT_FOUND" : "BAD_REQUEST");
    return { id, code, message: err.message };
  }
  return null;
}

export class TransactionService {
  constructor(
    private transactionRepo: ITransactionRepository,
    private accountRepo: IAccountRepository,
    private idempotencyRepo: IIdempotencyRepository,
    private categoryRepo: ICategoryRepository,
    private ledger: SharedLedgerService,
  ) {}

  async getAllTransactions(
    userId: string,
    pagination: PaginationParams | TransactionPagination,
    filters?: TransactionFilters,
  ): Promise<PaginatedResult<Transaction>> {
    return await this.transactionRepo.getAllByUserId(
      userId,
      pagination,
      filters,
    );
  }

  async getTags(userId: string): Promise<string[]> {
    return this.transactionRepo.listTags(userId);
  }

  async getTransactionById(id: string, userId: string): Promise<Transaction> {
    const transaction = await this.transactionRepo.getById(id);
    if (!transaction) {
      throw new ApiError("NotFound", "Transaction not found");
    }
    if (transaction.userId !== userId) {
      throw new ApiError("NotFound", "Transaction not found");
    }
    return transaction;
  }

  async createTransaction(
    dto: CreateTransactionDTO,
    timezone: string,
    idempotency?: IdempotencyMeta,
    outcome?: CreateOutcome,
  ): Promise<Transaction> {
    return createOrReplay({
      clientId: dto.id,
      outcome,
      findOwn: (id) => this.transactionRepo.getOwnById(id, dto.userId),
      replay: async (t) => t,
      create: () => this.insertTransaction(dto, timezone, idempotency),
    });
  }

  private async insertTransaction(
    dto: CreateTransactionDTO,
    timezone: string,
    idempotency?: IdempotencyMeta,
  ): Promise<Transaction> {
    if (idempotency) {
      const existing = await this.replayIdempotent(dto.userId, idempotency);
      if (existing) return existing;
    }

    const transaction = new Transaction({
      ...dto,
      dayKey: dayKeyOf(new Date(dto.date), timezone),
    });
    transaction.assertValid();
    await this.assertCategoryUsable(transaction);

    try {
      return await withTransaction(async (session) => {
        const created = await this.applyAndCreate(transaction, session);
        if (idempotency) {
          await this.idempotencyRepo.record(
            dto.userId,
            TXN_CREATE_SCOPE,
            idempotency.key,
            created.id,
            idempotency.requestHash,
            session,
          );
        }
        return created;
      });
    } catch (err) {
      if (idempotency && isDuplicateKeyError(err)) {
        const existing = await this.replayIdempotent(dto.userId, idempotency);
        if (existing) return existing;
      }
      throw err;
    }
  }

  // Written inside somebody else's transaction: a settle-up's movements land or fail with it.
  async recordWithin(
    dto: CreateTransactionDTO,
    timezone: string,
    session: TxSession,
  ): Promise<Transaction> {
    const transaction = new Transaction({
      ...dto,
      dayKey: dayKeyOf(new Date(dto.date), timezone),
    });
    transaction.assertValid();
    await this.assertCategoryUsable(transaction);
    return this.applyAndCreate(transaction, session);
  }

  /** A settle-up wrote this movement's money, so undoing the payment is what changes it. */
  private assertOnlyDetailChanges(dto: UpdateTransactionDTO): void {
    const monetary =
      dto.amount !== undefined ||
      dto.date !== undefined ||
      dto.type !== undefined ||
      dto.fromAccountId !== undefined ||
      dto.toAccountId !== undefined;
    if (monetary) {
      throw new ApiError(
        "BadRequest",
        "A settle-up recorded this movement: undo the payment instead of editing what it moved",
        "SETTLEMENT_MOVEMENT_LOCKED",
      );
    }
  }

  // What one settle-up recorded, which is what undoing it has to reverse.
  async settlementMovements(
    userId: string,
    sharedSettlementId: string,
    session: TxSession,
  ): Promise<Transaction[]> {
    return this.transactionRepo.listBySettlementId(
      userId,
      sharedSettlementId,
      session,
    );
  }

  /** Reverses what a movement did to the balances and drops it, inside the caller's transaction. */
  async reverseWithin(
    transaction: Transaction,
    session: TxSession,
  ): Promise<void> {
    await this.adjustBalances(transaction, -1, session);
    await this.transactionRepo.delete(transaction.id, session);
  }

  private async applyAndCreate(
    transaction: Transaction,
    session: TxSession,
  ): Promise<Transaction> {
    await this.adjustBalances(transaction, 1, session);
    return this.transactionRepo.create(transaction, session);
  }

  private async replayIdempotent(
    userId: string,
    idempotency: IdempotencyMeta,
  ): Promise<Transaction | null> {
    const record = await this.idempotencyRepo.find(
      userId,
      TXN_CREATE_SCOPE,
      idempotency.key,
    );
    if (!record) return null;
    if (record.requestHash !== idempotency.requestHash) {
      throw new ApiError(
        "UnprocessableEntity",
        "Idempotency-Key was already used with a different payload",
        "IDEMPOTENCY_PAYLOAD_MISMATCH",
      );
    }
    const transaction = await this.transactionRepo.getById(
      record.transactionId,
    );
    if (!transaction) {
      throw new ApiError(
        "Conflict",
        "The transaction created with this Idempotency-Key was deleted; retry with a new key",
        "IDEMPOTENCY_ORIGINAL_DELETED",
      );
    }
    return transaction;
  }

  // Only amount is required; the rest defaults, and the row is flagged pendingDetails for later.
  async quickAddTransaction(
    dto: QuickAddTransactionDTO,
    timezone: string,
    idempotency?: IdempotencyMeta,
    outcome?: CreateOutcome,
  ): Promise<Transaction> {
    return createOrReplay({
      clientId: dto.id,
      outcome,
      findOwn: (id) => this.transactionRepo.getOwnById(id, dto.userId),
      replay: async (t) => t,
      create: () => this.insertQuickAdd(dto, timezone, idempotency),
    });
  }

  private async insertQuickAdd(
    dto: QuickAddTransactionDTO,
    timezone: string,
    idempotency?: IdempotencyMeta,
  ): Promise<Transaction> {
    const type = dto.type ?? "EXPENSE";
    let fromAccountId = dto.fromAccountId ?? null;
    let toAccountId = dto.toAccountId ?? null;

    if ((type === "EXPENSE" || type === "TRANSFER") && !fromAccountId) {
      fromAccountId = await this.resolveDefaultAccountId(dto.userId);
    }
    if (type === "INCOME" && !toAccountId) {
      toAccountId = await this.resolveDefaultAccountId(dto.userId);
    }

    return this.insertTransaction(
      {
        id: dto.id,
        type,
        amount: dto.amount,
        date: dto.date ?? new Date(),
        categoryId: dto.categoryId ?? null,
        fromAccountId,
        toAccountId,
        userId: dto.userId,
        pendingDetails: true,
        source: "QUICK",
      },
      timezone,
      idempotency,
    );
  }

  private async resolveDefaultAccountId(userId: string): Promise<string> {
    const account = await this.accountRepo.getDefaultByUserId(userId);
    if (!account) {
      throw new ApiError(
        "BadRequest",
        "No default account set; set one or pass an account id",
        "NO_DEFAULT_ACCOUNT",
      );
    }
    return account.id;
  }

  /**
   * Completes several quick-adds in one request. Each item goes through
   * `updateTransaction`, so the batch cannot drift from what a single update
   * means — same validation, same audit trail, same refusal to touch balances
   * when only detail changes.
   *
   * Per the owner's decision, items are independent: each runs in its own
   * database transaction and one failure leaves only that item unsaved. They
   * run in sequence rather than in parallel, so a hundred cards cannot open a
   * hundred concurrent transactions.
   */
  async batchUpdateDetails(
    items: BatchDetailUpdate[],
    userId: string,
    timezone: string,
  ): Promise<BatchUpdateResult> {
    const updated: Transaction[] = [];
    const failed: BatchUpdateFailure[] = [];

    for (const { id, ...detail } of items) {
      try {
        updated.push(
          await this.updateTransaction(id, detail, userId, timezone),
        );
      } catch (err) {
        const failure = describeItemFailure(id, err);
        // Only the per-item failures this endpoint promises are swallowed; anything else must surface.
        if (!failure) throw err;
        failed.push(failure);
      }
    }

    return { updated, failed };
  }

  // §5.4: the caller must tell "already deleted" from "never existed".
  async isDeleted(id: string, userId: string): Promise<boolean> {
    return this.transactionRepo.isDeleted(id, userId);
  }

  async updateTransaction(
    id: string,
    dto: UpdateTransactionDTO,
    userId: string,
    timezone: string,
    expectedUpdatedAt?: Date,
  ): Promise<WithRestamps<Transaction>> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Transaction id does not match");
    }

    return await withTransaction(async (session) => {
      const journal = new RestampJournal();
      const existing = await this.transactionRepo.getById(id, session);
      if (!existing) {
        throw new ApiError("NotFound", "Transaction not found");
      }
      if (existing.userId !== userId) {
        throw new ApiError("NotFound", "Transaction not found");
      }
      // Read and write share the session, so this and the update's filter are one atomic decision.
      assertFresh(existing, expectedUpdatedAt, (t) => t);

      if (existing.sharedSettlementId) this.assertOnlyDetailChanges(dto);
      // A new amount carries whatever came back with it, so a payment is not undone by an edit.
      const amountChanged =
        dto.amount !== undefined && dto.amount !== existing.amount;
      const cameBack = existing.amount - existing.countsAsYours;
      const updated = new Transaction({
        ...existing,
        ...dto,
        ...(amountChanged
          ? {
              // The ledger has the last word; this only has to be a figure the entity accepts.
              countsAsYours: Math.max(0, (dto.amount as number) - cameBack),
            }
          : {}),
      });
      updated.assertValid();
      if (dto.categoryId !== undefined || dto.type !== undefined) {
        await this.assertCategoryUsable(updated, existing.categoryId);
      }

      // Reverse+reapply only when money moves: non-monetary edits work on archived accounts.
      const monetaryChanged =
        updated.type !== existing.type ||
        updated.amount !== existing.amount ||
        updated.fromAccountId !== existing.fromAccountId ||
        updated.toAccountId !== existing.toAccountId;
      if (monetaryChanged) {
        await this.adjustBalances(existing, -1, session);
        await this.adjustBalances(updated, 1, session);
      }

      // R2-27: the day only moves when the date does, or an unrelated edit re-books a past expense.
      const dateChanged = updated.date.getTime() !== existing.date.getTime();
      const patch: UpdateTransactionDTO & {
        dayKey?: string;
        countsAsYours?: number;
      } = { ...dto };
      if (dateChanged) patch.dayKey = dayKeyOf(updated.date, timezone);
      if (amountChanged) patch.countsAsYours = updated.countsAsYours;

      const auditableChange = monetaryChanged || dateChanged;
      const revision = auditableChange
        ? {
            at: new Date(),
            amount: existing.amount,
            type: existing.type,
            fromAccountId: existing.fromAccountId,
            toAccountId: existing.toAccountId,
            date: existing.date,
          }
        : undefined;

      const saved = await this.transactionRepo.update(
        id,
        patch,
        session,
        revision,
        expectedUpdatedAt,
      );
      const answer = existing.sharedExpenseId
        ? await this.ledger.restateExpense(
            existing,
            saved,
            existing.sharedExpenseId,
            session,
            journal,
          )
        : saved;
      return Object.assign(answer, {
        restamped: await this.ledger.restampsOf(userId, journal, session, {
          entity: "transaction",
          id,
        }),
      });
    });
  }

  async deleteTransaction(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<{ restamped: Restamp[] }> {
    return withTransaction(async (session) => {
      const journal = new RestampJournal();
      const transaction = await this.transactionRepo.getById(id, session);
      if (!transaction) {
        throw new ApiError("NotFound", "Transaction not found");
      }
      if (transaction.userId !== userId) {
        throw new ApiError("NotFound", "Transaction not found");
      }
      assertFresh(transaction, expectedUpdatedAt, (t) => t);
      if (transaction.sharedSettlementId) {
        throw new ApiError(
          "BadRequest",
          "A settle-up recorded this movement: undo the payment and it goes with it",
          "SETTLEMENT_MOVEMENT_LOCKED",
        );
      }

      await this.adjustBalances(transaction, -1, session);
      // The group's expense is this movement seen from the other side: one cannot outlive the other.
      if (transaction.sharedExpenseId) {
        await this.ledger.dropExpenseOf(
          transaction,
          transaction.sharedExpenseId,
          session,
          journal,
        );
      }
      await this.transactionRepo.delete(id, session, expectedUpdatedAt);
      return {
        restamped: await this.ledger.restampsOf(userId, journal, session),
      };
    });
  }

  // 404 for missing and foreign alike so ids cannot be probed; archived stays valid only if already set.
  private async assertCategoryUsable(
    transaction: Transaction,
    previousCategoryId: string | null = null,
  ): Promise<void> {
    const { categoryId, userId, type } = transaction;
    if (!categoryId) return;

    const category =
      await this.categoryRepo.getByIdIncludingArchived(categoryId);
    if (!category || category.userId !== userId) {
      throw new ApiError("NotFound", "Category not found");
    }
    if (category.archivedAt && categoryId !== previousCategoryId) {
      throw new ApiError(
        "BadRequest",
        "Category is archived",
        "CATEGORY_ARCHIVED",
      );
    }
    if (category.type && category.type !== type) {
      throw new ApiError(
        "BadRequest",
        `Category type ${category.type} does not match transaction type ${type}`,
        "CATEGORY_TYPE_MISMATCH",
      );
    }
  }

  private async adjustBalances(
    transaction: Transaction,
    direction: 1 | -1,
    session: TxSession,
  ): Promise<void> {
    const { type, amount, fromAccountId, toAccountId } = transaction;

    const adjustAccount = async (
      accountId: string,
      sign: number,
    ): Promise<void> => {
      // Existence is only checked on apply: a reversal must work on an account archived meanwhile.
      if (direction === 1) {
        const account = await this.accountRepo.getById(accountId, session);
        if (!account) {
          throw new ApiError(
            "NotFound",
            sign < 0
              ? "Source account not found"
              : "Destination account not found",
          );
        }
        // 404 for foreign accounts too: ids must not be probeable (R2-25a).
        if (account.userId !== transaction.userId) {
          throw new ApiError(
            "NotFound",
            sign < 0
              ? "Source account not found"
              : "Destination account not found",
          );
        }
        // Mono-currency: the transaction carries its account's currency.
        if (
          account.currency &&
          transaction.currency &&
          transaction.currency !== account.currency
        ) {
          throw new ApiError(
            "BadRequest",
            "Transfers between accounts with different currencies are not supported yet",
            "CURRENCY_MISMATCH",
          );
        }
        transaction.currency = transaction.currency ?? account.currency;
        // The currency is only known once the account is read, and a reversal replays a validated amount.
        if (direction === 1) {
          transaction.assertValidPrecision();
        }
        const refusal = refuseMovement(
          type,
          account.type,
          sign < 0 ? "from" : "to",
        );
        if (refusal) {
          throw new ApiError("BadRequest", refusal.message, refusal.code);
        }
        if (account.type === "LOAN" && sign > 0) {
          const outcome = await this.accountRepo.incrementBalanceCapped(
            accountId,
            amount * sign * direction,
            0,
            session,
          );
          if (outcome === "over") {
            throw new ApiError(
              "BadRequest",
              "A loan cannot be paid more than it still owes",
              "LOAN_OVERPAID",
            );
          }
          if (outcome === "missing") {
            throw new ApiError(
              "InternalServerError",
              "Account missing during balance adjustment",
            );
          }
          return;
        }
      }

      const applied = await this.accountRepo.incrementBalance(
        accountId,
        amount * sign * direction,
        session,
      );
      if (!applied) {
        // Aborts the Mongo transaction: a skipped increment would desync the balance from the ledger.
        throw new ApiError(
          "InternalServerError",
          "Account missing during balance adjustment",
        );
      }
    };

    if (type === "EXPENSE" && fromAccountId) {
      await adjustAccount(fromAccountId, -1);
    }

    if (type === "INCOME" && toAccountId) {
      await adjustAccount(toAccountId, 1);
    }

    // The three that name their own side: a transfer both, the other two exactly one.
    if (type === "TRANSFER" || type === "ADJUSTMENT" || type === "SETTLEMENT") {
      if (fromAccountId) {
        await adjustAccount(fromAccountId, -1);
      }
      if (toAccountId) {
        await adjustAccount(toAccountId, 1);
      }
    }
  }
}
