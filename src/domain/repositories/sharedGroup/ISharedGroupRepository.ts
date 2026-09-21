import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { TxSession } from "../../../shared/unitOfWork";
import { SharedGroup } from "../../entities/SharedGroup";
import { IRepository } from "../IRepository";

export interface SharedGroupFilters {
  ids?: string[];
  includeArchived?: boolean;
  // Only the groups this contact takes part in.
  contactId?: string;
}

export interface ISharedGroupRepository extends IRepository<SharedGroup> {
  // `expectedUpdatedAt` goes in the write's own filter: a guard checked before would race.
  update(
    id: string,
    entity: Partial<SharedGroup>,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroup>;
  // Archives and answers the archived row.
  delete(
    id: string,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroup>;

  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: SharedGroupFilters,
  ): Promise<PaginatedResult<SharedGroup>>;
  // Owner-scoped read for client-minted id replay; resolves archived rows too.
  getOwnById(id: string, userId: string): Promise<SharedGroup | null>;
  // Unlike getById, also resolves archived groups (read paths only).
  getByIdIncludingArchived(id: string): Promise<SharedGroup | null>;
  // `name` renames in the same write, so nobody can take the name in between.
  restore(
    id: string,
    userId: string,
    name?: string,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroup | null>;
}
