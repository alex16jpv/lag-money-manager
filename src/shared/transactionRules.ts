import {
  type AccountType,
  DEBT_ACCOUNT_FIELDS,
  type TransactionType,
} from "./constants";
import type { ErrorCode } from "./errorCodes";

export const DEBT_ACCOUNT_TYPES: readonly AccountType[] = Object.values(
  DEBT_ACCOUNT_FIELDS,
).flatMap((types) => [...types]);

export function isDebtAccountType(type: AccountType): boolean {
  return DEBT_ACCOUNT_TYPES.includes(type);
}

// An overdraft is the account that holds the money and sometimes dips below zero, so a salary landing there is income.
export const INCOME_REFUSED_ON: readonly AccountType[] = ["CARD", "LOAN"];

export type MovementSide = "from" | "to";

export interface RefusedMovement {
  code: ErrorCode;
  message: string;
}

export function refuseMovement(
  type: TransactionType,
  accountType: AccountType,
  side: MovementSide,
): RefusedMovement | null {
  if (
    type === "INCOME" &&
    side === "to" &&
    INCOME_REFUSED_ON.includes(accountType)
  ) {
    return {
      code: "INCOME_ON_CARD_OR_LOAN",
      message:
        "Money arriving at a card or a loan is not income: record a transfer from the account it came from, or an adjustment when it came from outside",
    };
  }
  return null;
}
