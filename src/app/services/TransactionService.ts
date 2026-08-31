import { Transaction } from "../../domain/entities/Transaction";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
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

export class TransactionService {
  constructor(
    private transactionRepo: ITransactionRepository,
    private accountRepo: IAccountRepository,
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

  async createTransaction(dto: CreateTransactionDTO): Promise<Transaction> {
    const transaction = new Transaction(dto);
    transaction.assertValid();

    // The balance adjustment and the transaction insert commit together: if
    // either fails, the whole thing rolls back and no money is left dangling.
    return await withTransaction(async (session) => {
      await this.adjustBalances(transaction, 1, session);
      return await this.transactionRepo.create(transaction, session);
    });
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

      // Reverse the old effect, apply the new one, persist — atomically.
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
      // On apply (direction 1) the account must exist and belong to the user.
      // On reverse (direction -1) we operate on the account the (already
      // validated) transaction referenced, without re-checking, so reversals
      // still work even if the account was archived in the meantime.
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
