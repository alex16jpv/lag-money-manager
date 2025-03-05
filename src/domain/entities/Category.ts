import { ApiError } from "../../shared/errors";

export class Category {
  id: number;
  name: string;

  constructor({ id, name }: any) {
    this.id = id;
    this.name = name!;
  }

  validate() {
    if (!this.name) {
      throw new ApiError("BadRequest", "'name' is required");
    }
  }
}
