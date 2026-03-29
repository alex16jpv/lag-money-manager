import { v7 as uuidv7 } from "uuid";
import { ApiError } from "../../../shared/errors";
import { Account } from "../../entities/Account";
import { AccountMongoModel } from "../../models/mongoose/AccountMongoModel";
import { IAccountRepository } from "./IAccountRepository";

export class AccountMongoRepository implements IAccountRepository {
  async getById(id: string): Promise<Account | null> {
    const doc = await AccountMongoModel.findById(id).lean();
    if (!doc) return null;
    return new Account({
      id: doc._id,
      name: doc.name,
      type: doc.type as Account["type"],
      balance: doc.balance,
      userId: doc.userId,
    });
  }

  async getAll(): Promise<Account[]> {
    const docs = await AccountMongoModel.find().lean();
    return docs.map(
      (doc) =>
        new Account({
          id: doc._id,
          name: doc.name,
          type: doc.type as Account["type"],
          balance: doc.balance,
          userId: doc.userId,
        }),
    );
  }

  async getAllByUserId(userId: string): Promise<Account[]> {
    const docs = await AccountMongoModel.find({ userId }).lean();
    return docs.map(
      (doc) =>
        new Account({
          id: doc._id,
          name: doc.name,
          type: doc.type as Account["type"],
          balance: doc.balance,
          userId: doc.userId,
        }),
    );
  }

  async create(account: Partial<Account>): Promise<Account> {
    const id = uuidv7();
    const doc = await AccountMongoModel.create({ _id: id, ...account });
    return new Account({
      id: doc._id,
      name: doc.name,
      type: doc.type as Account["type"],
      balance: doc.balance,
      userId: doc.userId,
    });
  }

  async update(id: string, account: Partial<Account>): Promise<Account> {
    const doc = await AccountMongoModel.findByIdAndUpdate(id, account, {
      new: true,
    }).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Account not found");
    }
    return new Account({
      id: doc._id,
      name: doc.name,
      type: doc.type as Account["type"],
      balance: doc.balance,
      userId: doc.userId,
    });
  }

  async delete(id: string): Promise<void> {
    const doc = await AccountMongoModel.findByIdAndDelete(id);
    if (!doc) {
      throw new ApiError("NotFound", "Account not found");
    }
  }
}
