import { Transaction } from "../../entities/Transaction";
import { IRepository } from "../IRepository";

export type ITransactionRepository = IRepository<Transaction>;
