import { Transaction } from "../../domain/entities/Transaction";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
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
