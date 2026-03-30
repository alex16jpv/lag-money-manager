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
    this.id = id!;
    this.name = name;
    this.email = email;
    this.password = password;
    this.createdAt = createdAt!;
    this.updatedAt = updatedAt!;
  }
}
