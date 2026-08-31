import { Account } from "../../domain/entities/Account";
import { AccountFilters, IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { ApiError } from "../../shared/errors";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { CreateAccountDTO, UpdateAccountDTO } from "../dtos/AccountDTO";

export class AccountService {
  constructor(private repo: IAccountRepository) {}

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
    const isFirst = (await this.repo.countByUserId(dto.userId)) === 0;
    const account = new Account({ ...dto, isDefault: isFirst });
    return new Account(await this.repo.create(account));
  }

  async setDefaultAccount(id: string, userId: string): Promise<Account> {
    const account = await this.repo.setDefault(id, userId);
    if (!account) {
      throw new ApiError("NotFound", "Account not found");
    }
    return account;
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

  // Archive (soft delete); allowed even with linked transactions.
  async deleteAccount(id: string, userId: string): Promise<void> {
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new ApiError("NotFound", "Account not found");
    }
    if (existing.userId !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }
    if (existing.isDefault) {
      throw new ApiError(
        "BadRequest",
        "Cannot archive the default account; set another account as default first",
      );
    }

    return await this.repo.delete(id);
  }

  async restoreAccount(id: string, userId: string): Promise<Account> {
    const restored = await this.repo.restore(id, userId);
    if (!restored) {
      throw new ApiError("NotFound", "Archived account not found");
    }
    return new Account(restored);
  }
}
