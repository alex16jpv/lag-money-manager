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
import { ErrorCode } from "../../shared/errorCodes";
import { ApiError } from "../../shared/errors";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { TxSession, withTransaction } from "../../shared/unitOfWork";
import {
  CreateTransactionDTO,
  QuickAddTransactionDTO,
  UpdateTransactionDTO,
} from "../dtos/TransactionDTO";

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === 11000
  );
}

// Scope in the stored key keeps future idempotent operations from colliding.
const TXN_CREATE_SCOPE = "txn-create";

const sameTags = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i]);

const sameInstant = (a: Date, b: Date | string): boolean =>
  a.getTime() === new Date(b).getTime();

function matchesCreate(t: Transaction, dto: CreateTransactionDTO): boolean {
  return (
    t.type === dto.type &&
    t.amount === dto.amount &&
    sameInstant(t.date, dto.date) &&
    t.categoryId === (dto.categoryId ?? null) &&
    t.description === (dto.description ?? null) &&
    t.fromAccountId === (dto.fromAccountId ?? null) &&
    t.toAccountId === (dto.toAccountId ?? null) &&
    sameTags(t.tags, dto.tags ?? []) &&
    t.note === (dto.note ?? null) &&
    t.source === (dto.source ?? "MANUAL") &&
    t.pendingDetails === (dto.pendingDetails ?? false)
  );
}

// Only what the client sent: the omitted date and account resolve to `now` and
// to whichever account is default *at that moment*, which no replay can match.
function matchesQuickAdd(t: Transaction, dto: QuickAddTransactionDTO): boolean {
  return (
    t.source === "QUICK" &&
    t.amount === dto.amount &&
    (dto.type === undefined || t.type === dto.type) &&
    (dto.date === undefined || sameInstant(t.date, dto.date)) &&
    (dto.categoryId === undefined || t.categoryId === dto.categoryId) &&
    (dto.fromAccountId === undefined ||
      t.fromAccountId === dto.fromAccountId) &&
    (dto.toAccountId === undefined || t.toAccountId === dto.toAccountId)
  );
}

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
  ) {}

  async getAllTransactions(
    userId: string,
    pagination: PaginationParams,
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
    idempotency?: IdempotencyMeta,
    outcome?: CreateOutcome,
  ): Promise<Transaction> {
    return createOrReplay({
      clientId: dto.id,
      outcome,
      findOwn: (id) => this.transactionRepo.getOwnById(id, dto.userId),
      matches: (t) => matchesCreate(t, dto),
      replay: async (t) => t,
      create: () => this.insertTransaction(dto, idempotency),
    });
  }

  private async insertTransaction(
    dto: CreateTransactionDTO,
    idempotency?: IdempotencyMeta,
  ): Promise<Transaction> {
    if (idempotency) {
      const existing = await this.replayIdempotent(dto.userId, idempotency);
      if (existing) return existing;
    }

    const transaction = new Transaction(dto);
    transaction.assertValid();
    await this.assertCategoryUsable(transaction);

    try {
      return await withTransaction(async (session) => {
        await this.adjustBalances(transaction, 1, session);
        const created = await this.transactionRepo.create(transaction, session);
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

  // Low-friction create: only amount is required; type defaults to EXPENSE, date
  // to now, and the missing side account to the user's default. Flagged
  // pendingDetails so the client can list these for later detailing.
  async quickAddTransaction(
    dto: QuickAddTransactionDTO,
    idempotency?: IdempotencyMeta,
    outcome?: CreateOutcome,
  ): Promise<Transaction> {
    return createOrReplay({
      clientId: dto.id,
      outcome,
      findOwn: (id) => this.transactionRepo.getOwnById(id, dto.userId),
      matches: (t) => matchesQuickAdd(t, dto),
      replay: async (t) => t,
      create: () => this.insertQuickAdd(dto, idempotency),
    });
  }

  private async insertQuickAdd(
    dto: QuickAddTransactionDTO,
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
  ): Promise<BatchUpdateResult> {
    const updated: Transaction[] = [];
    const failed: BatchUpdateFailure[] = [];

    for (const { id, ...detail } of items) {
      try {
        updated.push(await this.updateTransaction(id, detail, userId));
      } catch (err) {
        const failure = describeItemFailure(id, err);
        // Only the failures this endpoint promises to report per item are
        // swallowed; anything else is a real fault and must surface as one.
        if (!failure) throw err;
        failed.push(failure);
      }
    }

    return { updated, failed };
  }

  async updateTransaction(
    id: string,
    dto: UpdateTransactionDTO,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<Transaction> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Transaction id does not match");
    }

    return await withTransaction(async (session) => {
      const existing = await this.transactionRepo.getById(id, session);
      if (!existing) {
        throw new ApiError("NotFound", "Transaction not found");
      }
      if (existing.userId !== userId) {
        throw new ApiError("NotFound", "Transaction not found");
      }
      // Read and write share the session, so this check and the guard in the
      // update's filter are one atomic decision.
      assertFresh(existing, expectedUpdatedAt, (t) => t);

      const updated = new Transaction({ ...existing, ...dto });
      updated.assertValid();
      if (dto.categoryId !== undefined || dto.type !== undefined) {
        await this.assertCategoryUsable(updated, existing.categoryId);
      }

      // Reverse+reapply only when money moves change; this also lets
      // non-monetary edits succeed on transactions of archived accounts.
      const monetaryChanged =
        updated.type !== existing.type ||
        updated.amount !== existing.amount ||
        updated.fromAccountId !== existing.fromAccountId ||
        updated.toAccountId !== existing.toAccountId;
      if (monetaryChanged) {
        await this.adjustBalances(existing, -1, session);
        await this.adjustBalances(updated, 1, session);
      }

      // Monetary edits keep a pre-update snapshot (audit trail, R2-27).
      // The date counts here: moving money between periods reshapes budgets
      // and stats even though balances don't move.
      const auditableChange =
        monetaryChanged || updated.date.getTime() !== existing.date.getTime();
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

      return await this.transactionRepo.update(
        id,
        dto,
        session,
        revision,
        expectedUpdatedAt,
      );
    });
  }

  async deleteTransaction(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<void> {
    await withTransaction(async (session) => {
      const transaction = await this.transactionRepo.getById(id, session);
      if (!transaction) {
        throw new ApiError("NotFound", "Transaction not found");
      }
      if (transaction.userId !== userId) {
        throw new ApiError("NotFound", "Transaction not found");
      }
      assertFresh(transaction, expectedUpdatedAt, (t) => t);

      await this.adjustBalances(transaction, -1, session);
      await this.transactionRepo.delete(id, session, expectedUpdatedAt);
    });
  }

  // 404 covers both missing and foreign categories so ids can't be probed.
  // An archived category stays valid only while the transaction already had it.
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
      // Only check existence/ownership on apply; reversals must work even if the
      // account was archived meanwhile.
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
        // Mono-currency mode: the transaction carries its account's currency;
        // cross-currency transfers arrive with the multi-currency feature.
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
        // The currency is only known here, once the account is read, so this
        // is the first point where the minor-unit rule can be applied. Only
        // when applying: a reversal replays an amount already validated.
        if (direction === 1) {
          transaction.assertValidPrecision();
        }
      }

      const applied = await this.accountRepo.incrementBalance(
        accountId,
        amount * sign * direction,
        session,
      );
      if (!applied) {
        // Aborts the Mongo transaction: a silently skipped increment would
        // desync the stored balance from the ledger.
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

    if (type === "TRANSFER" || type === "ADJUSTMENT") {
      if (fromAccountId) {
        await adjustAccount(fromAccountId, -1);
      }
      if (toAccountId) {
        await adjustAccount(toAccountId, 1);
      }
    }
  }
}
