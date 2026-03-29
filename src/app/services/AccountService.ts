import { Account } from "../../domain/entities/Account";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { ApiError } from "../../shared/errors";
import { CreateAccountDTO, UpdateAccountDTO } from "../dtos/AccountDTO";

export class AccountService {
  constructor(private repo: IAccountRepository) {}

  async getAllAccounts(userId: string): Promise<Account[]> {
    const accounts = await this.repo.getAllByUserId(userId);
    return accounts?.map((account) => new Account(account));
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
    account.validate();
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

    return await this.repo.update(id, dto);
  }

  async deleteAccount(id: string, userId: string): Promise<void> {
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new ApiError("NotFound", "Account not found");
    }
    if (existing.userId !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }

    return await this.repo.delete(id);
  }
}
