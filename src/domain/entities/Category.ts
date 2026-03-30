export interface CategoryProps {
  id?: string;
  name: string;
  userId: string;
}

export class Category {
  id: string;
  name: string;
  userId: string;

  constructor({ id, name, userId }: CategoryProps) {
    this.id = id!;
    this.name = name;
    this.userId = userId;
  }
}
