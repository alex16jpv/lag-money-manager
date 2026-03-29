import { Category } from "../../entities/Category";
import { IRepository } from "../IRepository";

export interface ICategoryRepository extends IRepository<Category> {
  getAllByUserId(userId: string): Promise<Category[]>;
}
