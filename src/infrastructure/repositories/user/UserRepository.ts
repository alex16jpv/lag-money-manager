import { v7 as uuidv7 } from "uuid";

import { User } from "../../../domain/entities/User";
import { IUserRepository } from "../../../domain/repositories/user/IUserRepository";
import { ApiError } from "../../../shared/errors";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { UserModel } from "../../models/UserModel";

export class UserRepository implements IUserRepository {
  private toEntity(doc: {
    _id: string;
    name: string;
    email: string;
    password?: string;
    tokenVersion?: number;
    timezone?: string;
    currency?: string;
    lastLoginAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): User {
    return new User({
      id: doc._id,
      name: doc.name,
      email: doc.email,
      password: doc.password,
      tokenVersion: doc.tokenVersion,
      timezone: doc.timezone,
      currency: doc.currency,
      lastLoginAt: doc.lastLoginAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  async getById(id: string): Promise<User | null> {
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

  async getByIdWithPassword(id: string): Promise<User | null> {
    const doc = await UserModel.findOne({ _id: id, deletedAt: null }).lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async recordLogin(id: string): Promise<void> {
    await UserModel.updateOne(
      { _id: id, deletedAt: null },
      { lastLoginAt: new Date() },
    );
  }

  async updateWithTokenBump(id: string, fields: Partial<User>): Promise<User> {
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: fields, $inc: { tokenVersion: 1 } },
      { new: true },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "User not found");
    }
    return this.toEntity(doc);
  }

  async bumpTokenVersion(id: string): Promise<void> {
    await UserModel.updateOne(
      { _id: id, deletedAt: null },
      { $inc: { tokenVersion: 1 } },
    );
  }

  async getDeletedByEmail(email: string): Promise<User | null> {
    const doc = await UserModel.findOne({
      email,
      deletedAt: { $ne: null },
    }).lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async reactivate(
    id: string,
    updates: Pick<User, "name" | "password"> & Partial<Pick<User, "timezone">>,
  ): Promise<User> {
    // tokenVersion bump keeps any pre-deletion refresh tokens revoked.
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, deletedAt: { $ne: null } },
      { $set: { ...updates, deletedAt: null }, $inc: { tokenVersion: 1 } },
      { new: true },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "User not found");
    }
    return this.toEntity(doc);
  }

  async getAll(pagination: PaginationParams): Promise<PaginatedResult<User>> {
    const { limit, offset, cursor } = pagination;
    const filter: Record<string, unknown> = { deletedAt: null };
    if (cursor) {
      // Merge with an ids ($in) filter instead of clobbering it.
      filter._id =
        filter._id && typeof filter._id === "object"
          ? { ...(filter._id as Record<string, unknown>), $gt: cursor }
          : { $gt: cursor };
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

  async delete(id: string): Promise<void> {
    // tokenVersion bump revokes live refresh tokens; the access token still
    // survives its remaining ~15 min (stateless middleware by design).
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date() }, $inc: { tokenVersion: 1 } },
      { new: true },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "User not found");
    }
  }
}
