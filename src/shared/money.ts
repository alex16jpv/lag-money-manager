/**
 * Money is stored at rest as an integer number of cents and exposed through the
 * API / domain entities as a decimal amount (e.g. 10.55). Keeping the stored
 * value as an integer is what makes atomic `$inc` balance updates exact — a
 * float `$inc` would accumulate rounding error on every transaction.
 *
 * Convert at the persistence boundary only: `toCents` on the way in, `fromCents`
 * on the way out.
 */

/** Largest amount we accept, in the decimal (API) representation. */
export const MAX_AMOUNT = 1_000_000_000_000; // 1e12

/** Decimal amount (e.g. 10.55) -> integer cents (e.g. 1055). */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Integer cents (e.g. 1055) -> decimal amount (e.g. 10.55). */
export function fromCents(cents: number): number {
  return cents / 100;
}
