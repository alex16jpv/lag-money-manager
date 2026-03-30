import { v7 as uuidv7 } from "uuid";

export interface UserProps {
  id?: string;
  name: string;
  email: string;
  password?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class User {
  id: string;
  name: string;
  email: string;
  password?: string;
  createdAt: Date;
  updatedAt: Date;

  constructor({ id, name, email, password, createdAt, updatedAt }: UserProps) {
    this.id = id ?? uuidv7();
    this.name = name;
    this.email = email;
    this.password = password;
    this.createdAt = createdAt ?? new Date();
    this.updatedAt = updatedAt ?? new Date();
  }
}
