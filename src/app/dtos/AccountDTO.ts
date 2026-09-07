import { AccountType, Color } from "../../shared/constants";

export interface CreateAccountDTO {
  id?: string;
  name: string;
  type: AccountType;
  balance: number;
  color?: Color;
  userId: string;
}

export interface UpdateAccountDTO {
  id?: string;
  name?: string;
  type?: AccountType;
  color?: Color;
}
