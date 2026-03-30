import { Transaction } from "../../domain/entities/Transaction";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { ApiError } from "../../shared/errors";
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
  ): Promise<PaginatedResult<Transaction>> {
    return await this.transactionRepo.getAllByUserId(userId, pagination);
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

    await this.adjustBalances(transaction, 1);

    // TODO: Update budget balance when budget feature is implemented
    // if (transaction.categoryId) {
    //   await this.updateBudgetBalance(transaction.categoryId, transaction.amount, transaction.type);
    // }

    return await this.transactionRepo.create(transaction);
  }

  async updateTransaction(
    id: string,
    dto: UpdateTransactionDTO,
    userId: string,
  ): Promise<Transaction> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Transaction id does not match");
    }

    const existing = await this.transactionRepo.getById(id);
    if (!existing) {
      throw new ApiError("NotFound", "Transaction not found");
    }
    if (existing.userId !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }

    await this.adjustBalances(existing, -1);

    const updated = new Transaction({ ...existing, ...dto });

    await this.adjustBalances(updated, 1);

    return await this.transactionRepo.update(id, dto);
  }

  async deleteTransaction(id: string, userId: string): Promise<void> {
    const transaction = await this.transactionRepo.getById(id);
    if (!transaction) {
      throw new ApiError("NotFound", "Transaction not found");
    }
    if (transaction.userId !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }

    await this.adjustBalances(transaction, -1);

    return await this.transactionRepo.delete(id);
  }

  private async adjustBalances(
    transaction: Transaction,
    direction: 1 | -1,
  ): Promise<void> {
    const { type, amount, fromAccountId, toAccountId } = transaction;

    const adjustAccount = async (
      accountId: string,
      sign: number,
    ): Promise<void> => {
      const account = await this.accountRepo.getById(accountId);
      if (!account) {
        if (direction === 1) {
          throw new ApiError(
            "NotFound",
            sign < 0
              ? "Source account not found"
              : "Destination account not found",
          );
        }
        return;
      }
      if (direction === 1 && account.userId !== transaction.userId) {
        throw new ApiError(
          "Forbidden",
          sign < 0
            ? "Source account does not belong to the user"
            : "Destination account does not belong to the user",
        );
      }
      await this.accountRepo.update(accountId, {
        balance: Number(account.balance) + Number(amount) * sign * direction,
      });
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
