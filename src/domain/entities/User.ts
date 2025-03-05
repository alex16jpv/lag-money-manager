export interface UserProps {
  id: number;
  name: string;
  email: string;
}

export class User {
  id: UserProps["id"];
  name: UserProps["name"];

  constructor({ id, name }: Partial<UserProps>) {
    this.id = id!;
    this.name = name!;
  }
}
