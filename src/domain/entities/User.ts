import { DomainValidationError } from "../errors";

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
      throw new DomainValidationError("Email is required", "email");
    }

    if (!this.name) {
      throw new DomainValidationError("Name is required", "name");
    }
  }
}
