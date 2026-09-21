/**
 * A payment belongs to the person, not to the line it lands on: it covers the
 * oldest line first, and anything that changes the lines imputes it again over
 * what is left. The one place that decides it, for the server and the phone.
 */

export interface OwedLine {
  // The expense id, which also breaks the tie between two lines of the same day.
  key: string;
  date: Date;
  // Whole minor units, and never negative.
  owed: number;
}

export interface Imputation {
  settled: Map<string, number>;
  // What the pool could not cover: money held that nothing is owed for.
  surplus: number;
}

const oldestFirst = (a: OwedLine, b: OwedLine): number =>
  a.date.getTime() - b.date.getTime() ||
  (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function impute(lines: OwedLine[], pool: number): Imputation {
  let left = Math.max(0, pool);
  const settled = new Map<string, number>();
  for (const line of [...lines].sort(oldestFirst)) {
    const owed = Math.max(0, line.owed);
    const covered = Math.min(owed, left);
    settled.set(line.key, covered);
    left -= covered;
  }
  return { settled, surplus: left };
}
