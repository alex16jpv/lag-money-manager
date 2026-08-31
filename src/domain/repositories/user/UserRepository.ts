import { v7 as uuidv7 } from "uuid";

import { ApiError } from "../../../shared/errors";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { User } from "../../entities/User";
import { UserModel } from "../../models/UserModel";
import { IUserRepository } from "./IUserRepository";

export class UserRepository implements IUserRepository {
  private toEntity(doc: {
    _id: string;
    name: string;
    email: string;
    password: string;
    createdAt: Date;
    updatedAt: Date;
  }): User {
    return new User({
      id: doc._id,
      name: doc.name,
      email: doc.email,
      password: doc.password,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  async getById(id: string): Promise<User | null> {
    // Exclude the password hash: no getById caller needs it (login uses
    // getByEmail), so we keep it out of the read to shrink its exposure.
    const doc = await UserModel.findOne({ _id: id, deletedAt: null })
      .select("-password")
      .lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getByEmail(email: string): Promise<User | null> {
    const doc = await UserModel.findOne({ email, deletedAt: null }).lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getAll(pagination: PaginationParams): Promise<PaginatedResult<User>> {
    const { limit, offset, cursor } = pagination;
    const filter: Record<string, unknown> = { deletedAt: null };
    if (cursor) {
      filter._id = { $gt: cursor };
    }

    const [docs, total] = await Promise.all([
      UserModel.find(filter)
        .sort({ _id: 1 })
        .skip(cursor ? 0 : offset)
        .limit(limit)
        .lean(),
      UserModel.countDocuments({ deletedAt: null }),
    ]);

    return buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
  }

  async create(user: Partial<User>): Promise<User> {
    const id = user.id ?? uuidv7();
    const doc = await UserModel.create({ _id: id, ...user });
    return this.toEntity(doc);
  }

  async update(id: string, user: Partial<User>): Promise<User> {
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      user,
      { new: true },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "User not found");
    }
    return this.toEntity(doc);
  }

  // Soft delete: the user row is marked deleted (login and reads exclude it)
  // but their accounts, categories and transactions are left intact, so the
  // account can be fully restored by clearing deletedAt.
  async delete(id: string): Promise<void> {
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { deletedAt: new Date() },
      { new: true },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "User not found");
    }
  }
}
