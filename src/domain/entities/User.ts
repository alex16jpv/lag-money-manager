import { ApiError } from "../../shared/errors";

export interface UserProps {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export class User {
  id: UserProps["id"];
  name: UserProps["name"];
  email: UserProps["email"];
  createdAt: UserProps["createdAt"];
  updatedAt: UserProps["updatedAt"];

  constructor({ id, name, email, createdAt, updatedAt }: any) {
    this.id = id || null;
    this.name = name;
    this.email = email;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  validate() {
    if (!this.email) {
      throw new ApiError("BadRequest", "Email is required");
    }

    if (!this.name) {
      throw new ApiError("BadRequest", "Name is required");
    }
  }
}
