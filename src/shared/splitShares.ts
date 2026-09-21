import { DomainValidationError } from "../domain/errors";
import { SPLIT_MODES, SplitMode } from "./constants";
import { currencyDecimals } from "./currency";

// The one place an expense is divided: docs/modules/shared-groups.md says why it is this way.

export interface SplitRow {
  // 1 for a person; the head count for a guest block.
  units: number;
  // Percent under PERCENT, an amount under EXACT, an amount when pinned under FIXED_REST.
  input: number | null;
}

export interface SplitInput {
  total: number;
  currency: string;
  mode: SplitMode;
  rows: SplitRow[];
  // The row that fronted the money and therefore absorbs the odd minor unit.
  payerIndex: number;
}

const PERCENT_SCALE = 100;

const invalid = (message: string): DomainValidationError =>
  new DomainValidationError(message, "split", "SPLIT_INVALID");

const toMinor = (amount: number, scale: number): number =>
  Math.round(amount * scale);

/**
 * `floor(total * part / whole)`, split so no product can pass 2^53: the
 * quotient times a part never exceeds the total, and the remainder times a part
 * stays small. The plain product would, at the top of MAX_AMOUNT in a currency
 * with no minor unit, drift by one from an implementation using 64-bit
 * integers — which is the difference nobody can explain.
 */
const partOf = (total: number, part: number, whole: number): number =>
  Math.floor(total / whole) * part +
  Math.floor(((total % whole) * part) / whole);

function assertShape(input: SplitInput, scale: number): void {
  const { rows, payerIndex, mode } = input;
  if (rows.length === 0) {
    throw invalid("A split needs at least one share");
  }
  if (payerIndex < 0 || payerIndex >= rows.length) {
    throw invalid("The payer must be one of the shares");
  }
  if (rows.some((row) => !Number.isInteger(row.units) || row.units < 1)) {
    throw invalid("Every share weighs at least one part");
  }
  if (toMinor(input.total, scale) <= 0) {
    throw invalid("An expense to split must be greater than zero");
  }
  if (mode === SPLIT_MODES.EQUAL) {
    if (rows.some((row) => row.input !== null)) {
      throw invalid("An equal split takes no figures");
    }
    return;
  }
  if (mode === SPLIT_MODES.FIXED_REST) {
    if (rows.every((row) => row.input !== null)) {
      throw invalid(
        "A fixed-plus-rest split needs somebody to take the rest; use exact amounts instead",
      );
    }
    return;
  }
  if (rows.some((row) => row.input === null)) {
    throw invalid("Every share needs its own figure in this split");
  }
}

function equalShares(totalMinor: number, rows: SplitRow[]): number[] {
  const units = rows.reduce((sum, row) => sum + row.units, 0);
  return rows.map((row) => partOf(totalMinor, row.units, units));
}

function percentShares(totalMinor: number, rows: SplitRow[]): number[] {
  const basisPoints = rows.map((row) =>
    Math.round((row.input as number) * PERCENT_SCALE),
  );
  const whole = PERCENT_SCALE * PERCENT_SCALE;
  if (basisPoints.reduce((sum, bp) => sum + bp, 0) !== whole) {
    throw invalid("The percentages of a split must add up to 100");
  }
  if (basisPoints.some((bp) => bp < 0)) {
    throw invalid("A percentage cannot be negative");
  }
  return basisPoints.map((bp) => partOf(totalMinor, bp, whole));
}

function exactShares(
  totalMinor: number,
  rows: SplitRow[],
  scale: number,
): number[] {
  const shares = rows.map((row) => toMinor(row.input as number, scale));
  if (shares.some((share) => share < 0)) {
    throw invalid("A share cannot be negative");
  }
  if (shares.reduce((sum, share) => sum + share, 0) !== totalMinor) {
    throw invalid("The shares of a split must add up to the expense");
  }
  return shares;
}

function fixedRestShares(
  totalMinor: number,
  rows: SplitRow[],
  scale: number,
): number[] {
  const pinned = rows.map((row) =>
    row.input === null ? null : toMinor(row.input, scale),
  );
  if (pinned.some((share) => share !== null && share < 0)) {
    throw invalid("A share cannot be negative");
  }
  const pinnedTotal = pinned.reduce(
    (sum: number, share) => sum + (share ?? 0),
    0,
  );
  if (pinnedTotal > totalMinor) {
    throw invalid(
      "The fixed shares of a split add up to more than the expense",
    );
  }
  const restUnits = rows.reduce(
    (sum, row, index) => (pinned[index] === null ? sum + row.units : sum),
    0,
  );
  const rest = totalMinor - pinnedTotal;
  return rows.map(
    (row, index) => pinned[index] ?? partOf(rest, row.units, restUnits),
  );
}

/**
 * The shares of one expense, in the same order as `rows` and adding up to
 * `total` exactly. Throws `DomainValidationError` with code SPLIT_INVALID when
 * the figures cannot describe a split.
 */
export function resolveShares(input: SplitInput): number[] {
  const scale = 10 ** currencyDecimals(input.currency);
  assertShape(input, scale);

  const totalMinor = toMinor(input.total, scale);
  const shares =
    input.mode === SPLIT_MODES.EQUAL
      ? equalShares(totalMinor, input.rows)
      : input.mode === SPLIT_MODES.PERCENT
        ? percentShares(totalMinor, input.rows)
        : input.mode === SPLIT_MODES.EXACT
          ? exactShares(totalMinor, input.rows, scale)
          : fixedRestShares(totalMinor, input.rows, scale);

  const assigned = shares.reduce((sum, share) => sum + share, 0);
  shares[input.payerIndex] += totalMinor - assigned;
  return shares.map((share) => share / scale);
}
