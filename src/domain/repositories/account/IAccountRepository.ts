import { Account } from "../../entities/Account";

export interface IAccountRepository {
  getById(id: Account["id"]): Promise<Account | null>;
  getAll(): Promise<Account[]>;
  create(account: Account): Promise<Account>;
  update(id: Account["id"], account: Account): Promise<Account>;
  delete(id: Account["id"]): Promise<void>;
}
