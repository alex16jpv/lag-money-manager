import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { ChangeCursor } from "../../../shared/syncCursor";
import { Category } from "../../entities/Category";
import { IRepository } from "../IRepository";

export interface CategoryFilters {
  ids?: string[];
  type?: string;
  includeArchived?: boolean;
}

export interface ICategoryRepository extends IRepository<Category> {
  // `expectedUpdatedAt` goes in the write's own filter: a guard checked before would race.
  update(
    id: string,
    entity: Partial<Category>,
    session?: unknown,
    expectedUpdatedAt?: Date,
  ): Promise<Category>;
  // Archives and answers the archived row.
  delete(
    id: string,
    session?: unknown,
    expectedUpdatedAt?: Date,
  ): Promise<Category>;

  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: CategoryFilters,
  ): Promise<PaginatedResult<Category>>;
  // Owner-scoped read for client-minted id replay; resolves archived/deleted too.
  getOwnById(id: string, userId: string): Promise<Category | null>;

  // Change feed after `cursor` in (updatedAt, _id) order, archived and deleted rows included.
  changesSince(
    userId: string,
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<Category[]>;
  // Unlike getById, also resolves archived categories (callers decide the policy).
  getByIdIncludingArchived(id: string): Promise<Category | null>;
  // Duplicate-tolerant: skips (userId,name) duplicates, inserts the rest.
  createMany(entities: Partial<Category>[]): Promise<Category[]>;
  // Seed keys present for the user, archived included.
  listSeedKeys(userId: string): Promise<string[]>;
  // The ACTIVE row holding this name, matched as the unique index does; null when it is free.
  findActiveByName(userId: string, name: string): Promise<Category | null>;
  // Which of the given ids are the user's ARCHIVED categories (one query).
  listArchivedIds(userId: string, ids: string[]): Promise<string[]>;
  countByUserId(userId: string): Promise<number>;
  // `name` renames in the same write, so nobody can take the name in between.
  restore(
    id: string,
    userId: string,
    name?: string,
    expectedUpdatedAt?: Date,
  ): Promise<Category | null>;
}
