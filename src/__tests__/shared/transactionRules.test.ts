import { ACCOUNT_TYPES, TRANSACTION_TYPES } from "../../shared/constants";
import {
  DEBT_ACCOUNT_TYPES,
  INCOME_REFUSED_ON,
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

  it("refuses an income landing on a card or a loan", () => {
    for (const type of ["CARD", "LOAN"] as const) {
      expect(refuseMovement("INCOME", type, "to")?.code).toBe(
        "INCOME_ON_CARD_OR_LOAN",
      );
    }
  });

  it("takes an income on an overdraft, whose positive balance is its ordinary state", () => {
    expect(refuseMovement("INCOME", "OVERDRAFT", "to")).toBeNull();
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
          const refusedHere =
            transaction === "INCOME" &&
            side === "to" &&
            INCOME_REFUSED_ON.includes(account);
          expect(refused === null).toBe(!refusedHere);
        }
      }
    }
  });
});
