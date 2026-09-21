import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { TxSession } from "../../../shared/unitOfWork";
import { Contact } from "../../entities/Contact";
import { IRepository } from "../IRepository";

// A write that clears an optional field sends null; absent leaves it as it is.
export type ContactWrite = Partial<Omit<Contact, "color" | "email">> & {
  color?: Contact["color"] | null;
  email?: string | null;
};

export interface ContactFilters {
  ids?: string[];
  includeArchived?: boolean;
}

export interface IContactRepository extends IRepository<Contact> {
  // `expectedUpdatedAt` goes in the write's own filter: a guard checked before would race.
  update(
    id: string,
    entity: ContactWrite,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<Contact>;
  // Archives and answers the archived row.
  delete(
    id: string,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<Contact>;

  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: ContactFilters,
  ): Promise<PaginatedResult<Contact>>;
  // Owner-scoped read for client-minted id replay; resolves archived rows too.
  getOwnById(id: string, userId: string): Promise<Contact | null>;
  // Unlike getById, also resolves archived contacts (read paths only).
  getByIdIncludingArchived(id: string): Promise<Contact | null>;
  // Which of the given ids are the user's ACTIVE contacts, in one query.
  listActiveIds(userId: string, ids: string[]): Promise<string[]>;
  countByUserId(userId: string): Promise<number>;
  // `name` renames in the same write, so nobody can take the name in between.
  restore(
    id: string,
    userId: string,
    name?: string,
    expectedUpdatedAt?: Date,
  ): Promise<Contact | null>;
}
