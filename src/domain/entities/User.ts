interface UserProps {
  id: number;
  name: string;
  email: string;
}

export class User {
  id: UserProps["id"];
  name: UserProps["name"];
  email: UserProps["email"];

  constructor({ id, name, email }: UserProps) {
    this.id = id;
    this.name = name;
    this.email = email;
  }
}
