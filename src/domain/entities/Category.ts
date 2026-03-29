import { DomainValidationError } from "../errors";

export interface CategoryProps {
  id?: string;
  name: string;
}

export class Category {
  id: string;
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
