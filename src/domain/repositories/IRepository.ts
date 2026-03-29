export interface IRepository<T> {
  getById(id: string): Promise<T | null>;
  getAll(): Promise<T[]>;
  create(entity: T): Promise<T>;
  update(id: string, entity: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}
