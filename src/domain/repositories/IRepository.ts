import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { TxSession } from "../../shared/unitOfWork";

export interface IRepository<T> {
  getById(id: string, session?: TxSession): Promise<T | null>;
  getAll(pagination: PaginationParams): Promise<PaginatedResult<T>>;
  create(entity: Partial<T>, session?: TxSession): Promise<T>;
  update(id: string, entity: Partial<T>, session?: TxSession): Promise<T>;
  delete(id: string, session?: TxSession): Promise<void>;
}
