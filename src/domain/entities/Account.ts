import { DomainValidationError } from "../errors";
import { ACCOUNT_TYPES, AccountType } from "../../shared/constants";

export interface AccountProps {
  id?: number;
  name: string;
  type: AccountType;
  balance?: number;
  userId: number;
}

export class Account {
  id: number;
  name: string;
  type: AccountType;
  balance: number;
  userId: number;

  constructor({ id, name, type, balance, userId }: AccountProps) {
    this.id = id!;
    this.name = name;
    this.type = type;
    this.balance = balance ?? 0;
    this.userId = userId;
  }

  validate() {
    if (!this.userId) {
      throw new DomainValidationError("'userId' is required", "userId");
    }

    if (!this.name) {
      throw new DomainValidationError("'name' is required", "name");
    }

    if (!this.type) {
      throw new DomainValidationError("'type' is required", "type");
    }

    if (!ACCOUNT_TYPES[this.type]) {
      throw new DomainValidationError(
        `Invalid account type. Available: ${Object.values(ACCOUNT_TYPES).join(", ")}`,
        "type",
      );
    }
  }
}
