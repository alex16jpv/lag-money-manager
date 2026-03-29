import { AccountType } from "../../shared/constants";

export interface CreateAccountDTO {
  name: string;
  type: AccountType;
  balance: number;
  userId: number;
}

export interface UpdateAccountDTO {
  id?: number;
  name?: string;
  type?: AccountType;
  balance?: number;
  userId?: number;
}
