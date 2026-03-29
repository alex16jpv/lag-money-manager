export interface IRepository<T> {
  getById(id: number): Promise<T | null>;
  getAll(): Promise<T[]>;
  create(entity: T): Promise<T>;
  update(id: number, entity: Partial<T>): Promise<T>;
  delete(id: number): Promise<void>;
}
