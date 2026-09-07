import { DomainValidationError } from "../domain/errors";
import { currencyDecimals } from "./currency";

// Money is stored as integer cents and exposed as a decimal amount; convert
// only at the persistence boundary. Integer storage keeps $inc balance updates
// exact.
//
// The ceiling is where integer cents stop being exact in JavaScript: a value of
// 1e13 is 1e15 cents, and Number.MAX_SAFE_INTEGER is ~9.007e15. Single amounts
// therefore have two orders of magnitude of room, and a *balance* — which
// accumulates — stays exact up to about 9e13. Currencies with no minor unit and
// large everyday numbers (COP, IRR, VND, IDR) need this much: a house in COP
// costs more than the old 1e9 cap allowed.
export const MAX_AMOUNT = 10_000_000_000_000;

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

// True when the amount fits the currency's minor unit. Cannot live in the Zod
// schema: the body is validated before the request's currency is known.
export function hasValidPrecision(amount: number, decimals: number): boolean {
  const factor = 10 ** decimals;
  return Math.abs(amount * factor - Math.round(amount * factor)) < 1e-9;
}

/**
 * Throws when the amount carries more decimals than the currency has minor
 * units. Lives here rather than in the Zod schema because the currency is
 * resolved from the owner, after the body is validated.
 */
export function assertAmountPrecision(
  amount: number,
  currency: string,
  field: string,
): void {
  const decimals = currencyDecimals(currency);
  if (!hasValidPrecision(amount, decimals)) {
    throw new DomainValidationError(
      decimals === 0
        ? `${currency} amounts cannot have decimals`
        : `Amount must have at most ${decimals} decimal places`,
      field,
      "AMOUNT_PRECISION",
    );
  }
}
