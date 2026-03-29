import { Transaction } from "../../domain/entities/Transaction";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
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

  async getAllTransactions(): Promise<Transaction[]> {
    return await this.transactionRepo.getAll();
  }

  async getTransactionById(id: number): Promise<Transaction> {
    const transaction = await this.transactionRepo.getById(id);
    if (!transaction) {
      throw new ApiError("NotFound", "Transaction not found");
    }
    return transaction;
  }

  async createTransaction(dto: CreateTransactionDTO): Promise<Transaction> {
    const transaction = new Transaction(dto);
    transaction.validate();

    await this.applyBalanceChanges(transaction);

    // TODO: Update budget balance when budget feature is implemented
    // if (transaction.categoryId) {
    //   await this.updateBudgetBalance(transaction.categoryId, transaction.amount, transaction.type);
    // }

    return await this.transactionRepo.create(transaction);
  }

  async updateTransaction(
    id: number,
    dto: UpdateTransactionDTO,
  ): Promise<Transaction> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Transaction id does not match");
    }

    const existing = await this.transactionRepo.getById(id);
    if (!existing) {
      throw new ApiError("NotFound", "Transaction not found");
    }

    await this.reverseBalanceChanges(existing);

    const updated = new Transaction({ ...existing, ...dto });
    updated.validate();

    await this.applyBalanceChanges(updated);

    return await this.transactionRepo.update(id, dto);
  }

  async deleteTransaction(id: number): Promise<void> {
    const transaction = await this.transactionRepo.getById(id);
    if (!transaction) {
      throw new ApiError("NotFound", "Transaction not found");
    }

    await this.reverseBalanceChanges(transaction);

    return await this.transactionRepo.delete(id);
  }

  private async applyBalanceChanges(transaction: Transaction): Promise<void> {
    const { type, amount, fromAccountId, toAccountId } = transaction;

    if (type === "EXPENSE" && fromAccountId) {
      const account = await this.accountRepo.getById(fromAccountId);
      if (!account) {
        throw new ApiError("NotFound", "Source account not found");
      }
      await this.accountRepo.update(fromAccountId, {
        balance: Number(account.balance) - Number(amount),
      });
    }

    if (type === "INCOME" && toAccountId) {
      const account = await this.accountRepo.getById(toAccountId);
      if (!account) {
        throw new ApiError("NotFound", "Destination account not found");
      }
      await this.accountRepo.update(toAccountId, {
        balance: Number(account.balance) + Number(amount),
      });
    }

    if (type === "TRANSFER") {
      if (fromAccountId) {
        const fromAccount = await this.accountRepo.getById(fromAccountId);
        if (!fromAccount) {
          throw new ApiError("NotFound", "Source account not found");
        }
        await this.accountRepo.update(fromAccountId, {
          balance: Number(fromAccount.balance) - Number(amount),
        });
      }

      if (toAccountId) {
        const toAccount = await this.accountRepo.getById(toAccountId);
        if (!toAccount) {
          throw new ApiError("NotFound", "Destination account not found");
        }
        await this.accountRepo.update(toAccountId, {
          balance: Number(toAccount.balance) + Number(amount),
        });
      }
    }
  }

  private async reverseBalanceChanges(transaction: Transaction): Promise<void> {
    const { type, amount, fromAccountId, toAccountId } = transaction;

    if (type === "EXPENSE" && fromAccountId) {
      const account = await this.accountRepo.getById(fromAccountId);
      if (account) {
        await this.accountRepo.update(fromAccountId, {
          balance: Number(account.balance) + Number(amount),
        });
      }
    }

    if (type === "INCOME" && toAccountId) {
      const account = await this.accountRepo.getById(toAccountId);
      if (account) {
        await this.accountRepo.update(toAccountId, {
          balance: Number(account.balance) - Number(amount),
        });
      }
    }

    if (type === "TRANSFER") {
      if (fromAccountId) {
        const fromAccount = await this.accountRepo.getById(fromAccountId);
        if (fromAccount) {
          await this.accountRepo.update(fromAccountId, {
            balance: Number(fromAccount.balance) + Number(amount),
          });
        }
      }

      if (toAccountId) {
        const toAccount = await this.accountRepo.getById(toAccountId);
        if (toAccount) {
          await this.accountRepo.update(toAccountId, {
            balance: Number(toAccount.balance) - Number(amount),
          });
        }
      }
    }
  }
}
