import { ApiError } from "../../shared/errors";
import { ACCOUNT_TYPES } from "../models/AccountModel";

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

  constructor({ id, name, type, balance, userId }: any) {
    this.id = id || null;
    this.name = name!;
    this.type = type!;
    this.balance = balance! || 0;
    this.userId = userId!;
  }

  validate() {
    if (!this.userId) {
      throw new ApiError("BadRequest", "'userId' is required");
    }

    if (!this.name) {
      throw new ApiError("BadRequest", "'name' is required");
    }

    if (!this.type) {
      throw new ApiError("BadRequest", "'type' is required");
    }

    if (!ACCOUNT_TYPES[this.type]) {
      throw new ApiError("BadRequest", "Invalid account type", {
        availableTypes: Object.values(ACCOUNT_TYPES),
      });
    }
  }
}
