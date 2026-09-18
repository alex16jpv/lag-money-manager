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
  if (type === "INCOME" && side === "to" && isDebtAccountType(accountType)) {
    return {
      code: "INCOME_ON_DEBT_ACCOUNT",
      message:
        "Money arriving at a debt account is not income: record a transfer from the account it came from, or an adjustment when it came from outside",
    };
  }
  return null;
}
