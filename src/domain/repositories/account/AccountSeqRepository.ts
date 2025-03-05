import { ApiError } from "../../../shared/errors";
import { Account } from "../../entities/Account";
import { AccountModel } from "../../models/AccountModel";
import { IAccountRepository } from "./IAccountRepository";

export class AccountSeqRepository implements IAccountRepository {
  model: typeof AccountModel;

  constructor() {
    this.model = AccountModel;
  }

  async getById(id: Account["id"]): Promise<Account | null> {
    return await this.model.findByPk(id);
  }

  async getAll(): Promise<Account[]> {
    return await this.model.findAll();
  }

  async create(account: Partial<Account>): Promise<Account> {
    const result = await this.model.create(account);
    return result;
  }

  async update(id: Account["id"], account: Partial<Account>): Promise<Account> {
    const accountToUpdate = await this.model.findByPk(id);
    if (!accountToUpdate) {
      throw new ApiError("NotFound", "Account not found");
    }
    await accountToUpdate.update(account);
    await accountToUpdate.reload();
    return accountToUpdate.toJSON();
  }

  delete(id: Account["id"]): Promise<void> {
    throw new Error("Method not implemented.");
  }
}
