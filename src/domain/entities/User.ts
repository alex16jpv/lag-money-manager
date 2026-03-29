import { ApiError } from "../../shared/errors";

export interface UserProps {
  id?: number;
  name: string;
  email: string;
  password?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class User {
  id: number;
  name: string;
  email: string;
  password?: string;
  createdAt: Date;
  updatedAt: Date;

  constructor({ id, name, email, password, createdAt, updatedAt }: UserProps) {
    this.id = id!;
    this.name = name;
    this.email = email;
    this.password = password;
    this.createdAt = createdAt!;
    this.updatedAt = updatedAt!;
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
