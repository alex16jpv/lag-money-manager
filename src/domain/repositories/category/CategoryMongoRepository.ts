import { v7 as uuidv7 } from "uuid";
import { ApiError } from "../../../shared/errors";
import { Category } from "../../entities/Category";
import { CategoryMongoModel } from "../../models/mongoose/CategoryMongoModel";
import { ICategoryRepository } from "./ICategoryRepository";

export class CategoryMongoRepository implements ICategoryRepository {
  async getById(id: string): Promise<Category | null> {
    const doc = await CategoryMongoModel.findById(id).lean();
    if (!doc) return null;
    return new Category({ id: doc._id, name: doc.name });
  }

  async getAll(): Promise<Category[]> {
    const docs = await CategoryMongoModel.find().lean();
    return docs.map((doc) => new Category({ id: doc._id, name: doc.name }));
  }

  async create(category: Partial<Category>): Promise<Category> {
    const id = uuidv7();
    const doc = await CategoryMongoModel.create({ _id: id, ...category });
    return new Category({ id: doc._id, name: doc.name });
  }

  async update(id: string, category: Partial<Category>): Promise<Category> {
    const doc = await CategoryMongoModel.findByIdAndUpdate(id, category, {
      new: true,
    }).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Category not found");
    }
    return new Category({ id: doc._id, name: doc.name });
  }

  async delete(id: string): Promise<void> {
    const doc = await CategoryMongoModel.findByIdAndDelete(id);
    if (!doc) {
      throw new ApiError("NotFound", "Category not found");
    }
  }
}
