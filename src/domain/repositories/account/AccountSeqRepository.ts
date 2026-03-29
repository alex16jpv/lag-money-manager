import { ApiError } from "../../../shared/errors";
import { Account } from "../../entities/Account";
import { AccountModel } from "../../models/sequelize/AccountModel";
import { IAccountRepository } from "./IAccountRepository";

export class AccountSeqRepository implements IAccountRepository {
  model: typeof AccountModel;

  constructor() {
    this.model = AccountModel;
  }

  async getById(id: Account["id"]): Promise<Account | null> {
    const result = await this.model.findByPk(id);
    if (!result) {
      return null;
    }
    return new Account(result.toJSON());
  }

  async getAll(): Promise<Account[]> {
    const results = await this.model.findAll();
    return results.map((result) => new Account(result.toJSON()));
  }

  async create(account: Partial<Account>): Promise<Account> {
    const result = await this.model.create(account);
    return new Account(result.toJSON());
  }

  async update(id: Account["id"], account: Partial<Account>): Promise<Account> {
    const accountToUpdate = await this.model.findByPk(id);
    if (!accountToUpdate) {
      throw new ApiError("NotFound", "Account not found");
    }
    await accountToUpdate.update(account);
    await accountToUpdate.reload();
    return new Account(accountToUpdate.toJSON());
  }

  async delete(id: Account["id"]): Promise<void> {
    const account = await this.model.findByPk(id);
    if (!account) {
      throw new ApiError("NotFound", "Account not found");
    }
    await account.destroy();
  }
}
