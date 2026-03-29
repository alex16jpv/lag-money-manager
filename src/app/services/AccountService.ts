import { Account } from "../../domain/entities/Account";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { ApiError } from "../../shared/errors";
import { CreateAccountDTO, UpdateAccountDTO } from "../dtos/AccountDTO";

export class AccountService {
  constructor(private repo: IAccountRepository) {}

  async getAllAccounts(): Promise<Account[]> {
    const accounts = await this.repo.getAll();
    return accounts?.map((account) => new Account(account));
  }

  async getAccountById(id: string): Promise<Account> {
    const account = await this.repo.getById(id);

    if (!account) {
      throw new ApiError("NotFound", "Account not found");
    }
    return new Account(account);
  }

  async createAccount(dto: CreateAccountDTO): Promise<Account> {
    const account = new Account(dto);
    account.validate();
    return new Account(await this.repo.create(account));
  }

  async updateAccount(id: string, dto: UpdateAccountDTO): Promise<Account> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Account id does not match");
    }

    return await this.repo.update(id, dto);
  }

  async deleteAccount(id: string): Promise<void> {
    return await this.repo.delete(id);
  }
}
