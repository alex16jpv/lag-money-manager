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
    idempotencyKey?: string,
  ): Promise<Transaction> {
    if (idempotencyKey) {
      const existing = await this.replayIdempotent(dto.userId, idempotencyKey);
      if (existing) return existing;
    }

    const transaction = new Transaction(dto);
    transaction.assertValid();
    await this.assertCategoryUsable(transaction);

    try {
      return await withTransaction(async (session) => {
        await this.adjustBalances(transaction, 1, session);
        const created = await this.transactionRepo.create(transaction, session);
        if (idempotencyKey) {
          await this.idempotencyRepo.record(
            dto.userId,
            idempotencyKey,
            created.id,
            session,
          );
        }
        return created;
      });
    } catch (err) {
      if (idempotencyKey && isDuplicateKeyError(err)) {
        const existing = await this.replayIdempotent(dto.userId, idempotencyKey);
        if (existing) return existing;
      }
      throw err;
    }
  }

  private async replayIdempotent(
    userId: string,
    key: string,
  ): Promise<Transaction | null> {
    const id = await this.idempotencyRepo.findTransactionId(userId, key);
    if (!id) return null;
    return this.transactionRepo.getById(id);
  }

  // Low-friction create: only amount is required; type defaults to EXPENSE, date
  // to now, and the missing side account to the user's default. Flagged
  // pendingDetails so the client can list these for later detailing.
  async quickAddTransaction(
    dto: QuickAddTransactionDTO,
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

    return this.createTransaction({
      type,
      amount: dto.amount,
      date: dto.date ?? new Date(),
      categoryId: dto.categoryId ?? null,
      fromAccountId,
      toAccountId,
      userId: dto.userId,
      pendingDetails: true,
    });
  }

  private async resolveDefaultAccountId(userId: string): Promise<string> {
    const account = await this.accountRepo.getDefaultByUserId(userId);
    if (!account) {
      throw new ApiError(
        "BadRequest",
        "No default account set; set one or pass an account id",
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
      await this.assertCategoryUsable(updated, existing.categoryId);

      await this.adjustBalances(existing, -1, session);
      await this.adjustBalances(updated, 1, session);

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
      throw new ApiError("BadRequest", "Category is archived");
    }
    if (category.type && category.type !== type) {
      throw new ApiError(
        "BadRequest",
        `Category type ${category.type} does not match transaction type ${type}`,
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

    if (type === "TRANSFER") {
      if (fromAccountId) {
        await adjustAccount(fromAccountId, -1);
      }
      if (toAccountId) {
        await adjustAccount(toAccountId, 1);
      }
    }
  }
}
