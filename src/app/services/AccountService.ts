import { Account } from "../../domain/entities/Account";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { ApiError } from "../../shared/errors";

export class AccountService {
  constructor(private repo: IAccountRepository) {}

  async getAllAccounts(): Promise<Account[]> {
    const accounts = await this.repo.getAll();
    return accounts?.map((account) => new Account(account));
  }

  async getAccountById(id: number): Promise<Account> {
    const account = await this.repo.getById(id);

    if (!account) {
      throw new ApiError("NotFound", "Account not found");
    }
    return new Account(account);
  }

  async createAccount(account: Account): Promise<Account> {
    const accountToCreate = new Account(account);

    accountToCreate.validate();
    return new Account(await this.repo.create(accountToCreate));
  }

  async updateAccount(id: number, account: Account): Promise<Account> {
    if (account?.id && account.id !== id) {
      throw new ApiError("BadRequest", "Account id does not match");
    }

    return await this.repo.update(id, account);
  }
}
