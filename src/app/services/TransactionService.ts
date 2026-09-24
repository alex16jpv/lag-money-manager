import { Account } from "../../domain/entities/Account";
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
import { fromCents, toCents } from "../../shared/money";
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

interface BalanceMove {
  transaction: Transaction;
  direction: 1 | -1;
}

// An expense only leaves its account and an income only lands on its own; the rest name each side they use.
function sidesOf(transaction: Transaction): [string, 1 | -1][] {
  const { type, fromAccountId, toAccountId } = transaction;
  const sides: [string, 1 | -1][] = [];
  if (type !== "INCOME" && fromAccountId) sides.push([fromAccountId, -1]);
  if (type !== "EXPENSE" && toAccountId) sides.push([toAccountId, 1]);
  return sides;
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

const nothingRestamped = (row: Transaction): WithRestamps<Transaction> =>
  Object.assign(row, { restamped: [] });

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
  ): Promise<WithRestamps<Transaction>> {
    return createOrReplay({
      clientId: dto.id,
      outcome,
      findOwn: (id) => this.transactionRepo.getOwnById(id, dto.userId),
      replay: async (t) => nothingRestamped(t),
      create: () => this.insertTransaction(dto, timezone, idempotency),
    });
  }

  private async insertTransaction(
    dto: CreateTransactionDTO,
    timezone: string,
    idempotency?: IdempotencyMeta,
  ): Promise<WithRestamps<Transaction>> {
    if (idempotency) {
      const existing = await this.replayIdempotent(dto.userId, idempotency);
      if (existing) return nothingRestamped(existing);
    }

    const transaction = new Transaction({
      ...dto,
      dayKey: dayKeyOf(new Date(dto.date), timezone),
    });
    transaction.assertValid();
    await this.assertCategoryUsable(transaction);

    try {
      return await withTransaction(async (session) => {
        const journal = new RestampJournal();
        const created = await this.applyAndCreate(
          transaction,
          session,
          journal,
        );
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
        return Object.assign(created, {
          restamped: await this.ledger.restampsOf(dto.userId, journal, session),
        });
      });
    } catch (err) {
      if (idempotency && isDuplicateKeyError(err)) {
        const existing = await this.replayIdempotent(dto.userId, idempotency);
        if (existing) return nothingRestamped(existing);
      }
      throw err;
    }
  }

  // Written inside somebody else's transaction: a settle-up's movements land or fail with it.
  async recordWithin(
    dtos: CreateTransactionDTO[],
    timezone: string,
    session: TxSession,
    journal: RestampJournal,
  ): Promise<Transaction[]> {
    const transactions: Transaction[] = [];
    for (const dto of dtos) {
      const transaction = new Transaction({
        ...dto,
        dayKey: dayKeyOf(new Date(dto.date), timezone),
      });
      transaction.assertValid();
      await this.assertCategoryUsable(transaction);
      transactions.push(transaction);
    }
    await this.moveBalances(
      transactions.map((transaction) => ({ transaction, direction: 1 })),
      session,
      journal,
    );
    const created: Transaction[] = [];
    for (const transaction of transactions) {
      created.push(await this.transactionRepo.create(transaction, session));
    }
    return created;
  }

  // The movement is the only write of the caller's transaction, so what it rewrote is the answer's.
  async recordAnswered(
    dto: CreateTransactionDTO,
    timezone: string,
    session: TxSession,
  ): Promise<WithRestamps<Transaction>> {
    const journal = new RestampJournal();
    const [recorded] = await this.recordWithin(
      [dto],
      timezone,
      session,
      journal,
    );
    if (!recorded) {
      throw new ApiError(
        "InternalServerError",
        "The movement was not recorded",
      );
    }
    return Object.assign(recorded, {
      restamped: await this.ledger.restampsOf(dto.userId, journal, session),
    });
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

  // One net per account, so undoing a payment does not depend on the order its movements come back in.
  async reverseWithin(
    transactions: Transaction[],
    session: TxSession,
    journal: RestampJournal,
  ): Promise<void> {
    await this.moveBalances(
      transactions.map((transaction) => ({ transaction, direction: -1 })),
      session,
      journal,
    );
    for (const transaction of transactions) {
      await this.transactionRepo.delete(transaction.id, session);
    }
  }

  private async applyAndCreate(
    transaction: Transaction,
    session: TxSession,
    journal: RestampJournal,
  ): Promise<Transaction> {
    await this.moveBalances([{ transaction, direction: 1 }], session, journal);
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
  ): Promise<WithRestamps<Transaction>> {
    return createOrReplay({
      clientId: dto.id,
      outcome,
      findOwn: (id) => this.transactionRepo.getOwnById(id, dto.userId),
      replay: async (t) => nothingRestamped(t),
      create: () => this.insertQuickAdd(dto, timezone, idempotency),
    });
  }

  private async insertQuickAdd(
    dto: QuickAddTransactionDTO,
    timezone: string,
    idempotency?: IdempotencyMeta,
  ): Promise<WithRestamps<Transaction>> {
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
      const cameBack =
        toCents(existing.amount) - toCents(existing.countsAsYours);
      const updated = new Transaction({
        ...existing,
        ...dto,
        ...(amountChanged
          ? {
              // The ledger has the last word; this only has to be a figure the entity accepts.
              countsAsYours: fromCents(
                Math.max(0, toCents(dto.amount as number) - cameBack),
              ),
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
        await this.moveBalances(
          [
            { transaction: existing, direction: -1 },
            { transaction: updated, direction: 1 },
          ],
          session,
          journal,
        );
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

      await this.moveBalances(
        [{ transaction, direction: -1 }],
        session,
        journal,
      );
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

  // Each account moves once, by the net of every move: a LOAN is capped on where it ends, not on a step.
  private async moveBalances(
    moves: BalanceMove[],
    session: TxSession,
    journal: RestampJournal,
  ): Promise<void> {
    const net = new Map<string, number>();
    const applied = new Map<string, Account>();
    for (const { transaction, direction } of moves) {
      for (const [accountId, sign] of sidesOf(transaction)) {
        if (direction === 1) {
          applied.set(
            accountId,
            await this.assertAccountTakes(
              transaction,
              accountId,
              sign,
              session,
            ),
          );
        }
        net.set(
          accountId,
          (net.get(accountId) ?? 0) +
            toCents(transaction.amount) * sign * direction,
        );
      }
    }
    for (const [accountId, cents] of net) {
      if (cents === 0) continue;
      await this.incrementAccount(
        accountId,
        cents,
        applied.get(accountId),
        session,
        journal,
      );
    }
  }

  private async assertAccountTakes(
    transaction: Transaction,
    accountId: string,
    sign: 1 | -1,
    session: TxSession,
  ): Promise<Account> {
    const account = await this.accountRepo.getById(accountId, session);
    // 404 for foreign accounts too: ids must not be probeable (R2-25a).
    if (!account || account.userId !== transaction.userId) {
      throw new ApiError(
        "NotFound",
        sign < 0 ? "Source account not found" : "Destination account not found",
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
    transaction.assertValidPrecision();
    const refusal = refuseMovement(
      transaction.type,
      account.type,
      sign < 0 ? "from" : "to",
    );
    if (refusal) {
      throw new ApiError("BadRequest", refusal.message, refusal.code);
    }
    return account;
  }

  private async incrementAccount(
    accountId: string,
    cents: number,
    applied: Account | undefined,
    session: TxSession,
    journal: RestampJournal,
  ): Promise<void> {
    const delta = fromCents(cents);
    const target =
      cents > 0
        ? (applied ??
          (await this.accountRepo.getByIdIncludingArchived(accountId, session)))
        : undefined;
    if (target?.type === "LOAN") {
      journal.note("account", target);
      const outcome = await this.accountRepo.incrementBalanceCapped(
        accountId,
        delta,
        0,
        session,
      );
      if (outcome === "over") {
        throw new ApiError(
          "BadRequest",
          "A loan cannot end above zero: it cannot be paid more than it still owes",
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

    const before = await this.accountRepo.incrementBalance(
      accountId,
      delta,
      session,
    );
    if (!before) {
      // Aborts the Mongo transaction: a skipped increment would desync the balance from the ledger.
      throw new ApiError(
        "InternalServerError",
        "Account missing during balance adjustment",
      );
    }
    journal.note("account", { id: accountId, ...before });
  }
}
