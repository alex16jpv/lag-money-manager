import { ApiError } from "../../shared/errors";

export interface CategoryProps {
  id: number;
  name: string;
}

export class Category {
  id: CategoryProps["id"];
  name: CategoryProps["name"];

  constructor({ id, name }: CategoryProps) {
    this.id = id;
    this.name = name;
  }

  validate() {
    if (!this.name) {
      throw new ApiError("BadRequest", "'name' is required");
    }
  }
}
