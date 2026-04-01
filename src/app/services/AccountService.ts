import { Account } from "../../domain/entities/Account";
import { AccountFilters, IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { ApiError } from "../../shared/errors";
import { CreateAccountDTO, UpdateAccountDTO } from "../dtos/AccountDTO";

export class AccountService {
  constructor(
    private repo: IAccountRepository,
    private transactionRepo: ITransactionRepository,
  ) {}

  async getAllAccounts(
    userId: string,
    pagination: PaginationParams,
    filters?: AccountFilters,
  ): Promise<PaginatedResult<Account>> {
    const result = await this.repo.getAllByUserId(userId, pagination, filters);
    return {
      data: result.data.map((account) => new Account(account)),
      pagination: result.pagination,
    };
  }

  async getAccountById(id: string, userId: string): Promise<Account> {
    const account = await this.repo.getById(id);

    if (!account) {
      throw new ApiError("NotFound", "Account not found");
    }
    if (account.userId !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }
    return new Account(account);
  }

  async createAccount(dto: CreateAccountDTO): Promise<Account> {
    const account = new Account(dto);
    return new Account(await this.repo.create(account));
  }

  async updateAccount(
    id: string,
    dto: UpdateAccountDTO,
    userId: string,
  ): Promise<Account> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Account id does not match");
    }

    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new ApiError("NotFound", "Account not found");
    }
    if (existing.userId !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }

    return new Account(await this.repo.update(id, dto));
  }

  async deleteAccount(id: string, userId: string): Promise<void> {
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new ApiError("NotFound", "Account not found");
    }
    if (existing.userId !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }

    const linked = await this.transactionRepo.getAllByUserId(userId, { limit: 1, offset: 0 }, { accountId: id });
    if (linked.data.length > 0) {
      throw new ApiError("BadRequest", "Cannot delete account with associated transactions");
    }

    return await this.repo.delete(id);
  }
}
