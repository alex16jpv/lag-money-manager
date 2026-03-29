import { DomainValidationError } from "../errors";
import { ACCOUNT_TYPES } from "../../shared/constants";

export interface AccountProps {
  id: number;
  name: string;
  type: keyof typeof ACCOUNT_TYPES;
  balance: number;
  userId: number;
}

export class Account {
  id: AccountProps["id"];
  name: AccountProps["name"];
  type: AccountProps["type"];
  balance: AccountProps["balance"];
  userId: AccountProps["userId"];

  constructor({ id, name, type, balance, userId }: AccountProps) {
    this.id = id || null!;
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
