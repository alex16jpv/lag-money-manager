import { Color } from "../../shared/constants";

export interface CreateContactDTO {
  id?: string;
  name: string;
  color?: Color;
  email?: string;
  userId: string;
}

export interface UpdateContactDTO {
  id?: string;
  name?: string;
  color?: Color | null;
  email?: string | null;
}
