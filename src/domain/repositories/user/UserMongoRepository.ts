import { v7 as uuidv7 } from "uuid";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { ApiError } from "../../../shared/errors";
import { User } from "../../entities/User";
import { UserMongoModel } from "../../models/mongoose/UserMongoModel";
import { IUserRepository } from "./IUserRepository";

export class UserMongoRepository implements IUserRepository {
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
    const doc = await UserMongoModel.findById(id).lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getByEmail(email: string): Promise<User | null> {
    const doc = await UserMongoModel.findOne({ email }).lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getAll(pagination: PaginationParams): Promise<PaginatedResult<User>> {
    const { limit, offset, cursor } = pagination;
    const filter: Record<string, unknown> = {};
    if (cursor) {
      filter._id = { $gt: cursor };
    }

    const [docs, total] = await Promise.all([
      UserMongoModel.find(filter)
        .sort({ _id: 1 })
        .skip(cursor ? 0 : offset)
        .limit(limit)
        .lean(),
      UserMongoModel.countDocuments(),
    ]);

    return buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
  }

  async create(user: Partial<User>): Promise<User> {
    const id = uuidv7();
    const doc = await UserMongoModel.create({ _id: id, ...user });
    return this.toEntity(doc);
  }

  async update(id: string, user: Partial<User>): Promise<User> {
    const doc = await UserMongoModel.findByIdAndUpdate(id, user, {
      new: true,
    }).lean();
    if (!doc) {
      throw new ApiError("NotFound", "User not found");
    }
    return this.toEntity(doc);
  }

  async delete(id: string): Promise<void> {
    const doc = await UserMongoModel.findByIdAndDelete(id);
    if (!doc) {
      throw new ApiError("NotFound", "User not found");
    }
  }
}
