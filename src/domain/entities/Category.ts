import { DomainValidationError } from "../errors";

export interface CategoryProps {
  id?: number;
  name: string;
}

export class Category {
  id: number;
  name: string;

  constructor({ id, name }: CategoryProps) {
    this.id = id!;
    this.name = name;
  }

  validate() {
    if (!this.name) {
      throw new DomainValidationError("'name' is required", "name");
    }
  }
}
