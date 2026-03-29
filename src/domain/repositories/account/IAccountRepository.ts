import { Account } from "../../entities/Account";
import { IRepository } from "../IRepository";

export interface IAccountRepository extends IRepository<Account> {
  getAllByUserId(userId: string): Promise<Account[]>;
}
