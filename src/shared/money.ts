// Money is stored as integer cents and exposed as a decimal amount; convert
// only at the persistence boundary. Integer storage keeps $inc balance updates exact.
export const MAX_AMOUNT = 1_000_000_000_000;

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}
