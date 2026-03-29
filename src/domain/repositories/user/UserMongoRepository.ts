import { v7 as uuidv7 } from "uuid";
import { ApiError } from "../../../shared/errors";
import { User } from "../../entities/User";
import { UserMongoModel } from "../../models/mongoose/UserMongoModel";
import { IUserRepository } from "./IUserRepository";

export class UserMongoRepository implements IUserRepository {
  async getById(id: string): Promise<User | null> {
    const doc = await UserMongoModel.findById(id).lean();
    if (!doc) return null;
    return new User({
      id: doc._id,
      name: doc.name,
      email: doc.email,
      password: doc.password,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  async getByEmail(email: string): Promise<User | null> {
    const doc = await UserMongoModel.findOne({ email }).lean();
    if (!doc) return null;
    return new User({
      id: doc._id,
      name: doc.name,
      email: doc.email,
      password: doc.password,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  async getAll(): Promise<User[]> {
    const docs = await UserMongoModel.find().lean();
    return docs.map(
      (doc) =>
        new User({
          id: doc._id,
          name: doc.name,
          email: doc.email,
          password: doc.password,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        }),
    );
  }

  async create(user: Partial<User>): Promise<User> {
    const id = uuidv7();
    const doc = await UserMongoModel.create({ _id: id, ...user });
    return new User({
      id: doc._id,
      name: doc.name,
      email: doc.email,
      password: doc.password,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  async update(id: string, user: Partial<User>): Promise<User> {
    const doc = await UserMongoModel.findByIdAndUpdate(id, user, {
      new: true,
    }).lean();
    if (!doc) {
      throw new ApiError("NotFound", "User not found");
    }
    return new User({
      id: doc._id,
      name: doc.name,
      email: doc.email,
      password: doc.password,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  async delete(id: string): Promise<void> {
    const doc = await UserMongoModel.findByIdAndDelete(id);
    if (!doc) {
      throw new ApiError("NotFound", "User not found");
    }
  }
}
