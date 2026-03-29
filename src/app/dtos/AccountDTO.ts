import { AccountType } from "../../shared/constants";

export interface CreateAccountDTO {
  name: string;
  type: AccountType;
  balance: number;
  userId: string;
}

export interface UpdateAccountDTO {
  id?: string;
  name?: string;
  type?: AccountType;
  balance?: number;
}
