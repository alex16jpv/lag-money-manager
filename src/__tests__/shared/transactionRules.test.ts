import { ACCOUNT_TYPES, TRANSACTION_TYPES } from "../../shared/constants";
import {
  DEBT_ACCOUNT_TYPES,
  isDebtAccountType,
  refuseMovement,
} from "../../shared/transactionRules";

const ALL_ACCOUNT_TYPES = Object.values(ACCOUNT_TYPES);
const ALL_TRANSACTION_TYPES = Object.values(TRANSACTION_TYPES);

describe("transaction rules", () => {
  it("knows the three types that are debt, derived from the fields they carry", () => {
    expect([...DEBT_ACCOUNT_TYPES].sort()).toEqual([
      "CARD",
      "LOAN",
      "OVERDRAFT",
    ]);
    expect(ALL_ACCOUNT_TYPES.filter(isDebtAccountType).sort()).toEqual([
      "CARD",
      "LOAN",
      "OVERDRAFT",
    ]);
  });

  it("refuses an income landing on any debt account", () => {
    for (const type of DEBT_ACCOUNT_TYPES) {
      expect(refuseMovement("INCOME", type, "to")?.code).toBe(
        "INCOME_ON_DEBT_ACCOUNT",
      );
    }
  });

  it("leaves an income into an account that holds money alone", () => {
    for (const type of ALL_ACCOUNT_TYPES.filter((t) => !isDebtAccountType(t))) {
      expect(refuseMovement("INCOME", type, "to")).toBeNull();
    }
  });

  it("refuses nothing else: paying a debt, spending with it and reconciling it stay open", () => {
    for (const transaction of ALL_TRANSACTION_TYPES) {
      for (const account of ALL_ACCOUNT_TYPES) {
        for (const side of ["from", "to"] as const) {
          const refused = refuseMovement(transaction, account, side);
          const isIncomeIntoDebt =
            transaction === "INCOME" &&
            side === "to" &&
            isDebtAccountType(account);
          expect(refused === null).toBe(!isIncomeIntoDebt);
        }
      }
    }
  });
});
