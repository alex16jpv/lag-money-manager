import { Transaction } from "../../domain/entities/Transaction";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { IIdempotencyRepository } from "../../domain/repositories/idempotency/IIdempotencyRepository";
import {
  ITransactionRepository,
  TransactionFilters,
} from "../../domain/repositories/transaction/ITransactionRepository";
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

export interface IdempotencyMeta {
  key: string;
  requestHash: string;
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
      throw new ApiError("Forbidden", "Access denied");
    }
    return transaction;
  }

  async createTransaction(
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

    return this.createTransaction(
      {
        type,
        amount: dto.amount,
        date: dto.date ?? new Date(),
        categoryId: dto.categoryId ?? null,
        fromAccountId,
        toAccountId,
        userId: dto.userId,
        pendingDetails: true,
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

  async updateTransaction(
    id: string,
    dto: UpdateTransactionDTO,
    userId: string,
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
        throw new ApiError("Forbidden", "Access denied");
      }

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

      return await this.transactionRepo.update(id, dto, session);
    });
  }

  async deleteTransaction(id: string, userId: string): Promise<void> {
    await withTransaction(async (session) => {
      const transaction = await this.transactionRepo.getById(id, session);
      if (!transaction) {
        throw new ApiError("NotFound", "Transaction not found");
      }
      if (transaction.userId !== userId) {
        throw new ApiError("Forbidden", "Access denied");
      }

      await this.adjustBalances(transaction, -1, session);
      await this.transactionRepo.delete(id, session);
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
      throw new ApiError("BadRequest", "Category is archived", "CATEGORY_ARCHIVED");
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
        if (account.userId !== transaction.userId) {
          throw new ApiError(
            "Forbidden",
            sign < 0
              ? "Source account does not belong to the user"
              : "Destination account does not belong to the user",
          );
        }
      }

      await this.accountRepo.incrementBalance(
        accountId,
        amount * sign * direction,
        session,
      );
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
