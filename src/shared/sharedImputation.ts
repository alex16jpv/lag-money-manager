// The one place a payment is spread over what is owed, for the server and for the phone.

export interface OwedLine {
  // The expense id, which also breaks the tie between two lines of the same day.
  key: string;
  date: Date;
  // Whole minor units, and never negative.
  owed: number;
  groupId: string | null;
}

export interface SettledPayment {
  id: string;
  // Missing only on a payment not stored yet, which goes after every stored one.
  createdAt?: Date;
  // Whole minor units.
  collected: number;
  paid: number;
  groupId: string | null;
}

export interface CounterpartyImputation {
  theirs: Map<string, number>;
  yours: Map<string, number>;
  surplus: {
    // What they handed over that no line of theirs is owed for.
    theirs: number;
    // What you handed back beyond everything they ever gave you.
    yours: number;
  };
}

interface Payment {
  amount: number;
  groupId: string | null;
}

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const oldestFirst = (
  a: { date: Date; key: string },
  b: { date: Date; key: string },
): number => a.date.getTime() - b.date.getTime() || byKey(a.key, b.key);

const creationOrder = (a: SettledPayment, b: SettledPayment): number =>
  (a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
    (b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER) || byKey(a.id, b.id);

function impute(
  lines: readonly OwedLine[],
  payments: readonly Payment[],
): { settled: Map<string, number>; surplus: number } {
  const ordered = [...lines].sort(oldestFirst);
  const open = ordered.map((line) => Math.max(0, line.owed));
  const everyLine = [...ordered.keys()];
  let firstOpen = 0;
  let surplus = 0;
  for (const payment of payments) {
    let left = Math.max(0, payment.amount);
    while (firstOpen < open.length && open[firstOpen] === 0) firstOpen += 1;
    const ownGroup =
      payment.groupId === null
        ? []
        : everyLine.filter((i) => ordered[i].groupId === payment.groupId);
    for (const i of [...ownGroup, ...everyLine.slice(firstOpen)]) {
      if (left === 0) break;
      const covered = Math.min(open[i], left);
      open[i] -= covered;
      left -= covered;
    }
    surplus += left;
  }
  return {
    settled: new Map(
      ordered.map((line, i) => [line.key, Math.max(0, line.owed) - open[i]]),
    ),
    surplus,
  };
}

function withoutNewest(
  payments: readonly Payment[],
  amount: number,
): Payment[] {
  let left = Math.max(0, amount);
  return [...payments]
    .reverse()
    .map((payment) => {
      const kept = Math.max(0, payment.amount);
      const taken = Math.min(kept, left);
      left -= taken;
      return { ...payment, amount: kept - taken };
    })
    .reverse();
}

/** One person's payments in the order recorded, each covering its group's open lines first and then the oldest; what you hand back beyond your lines comes off their newest money. */
export function imputeCounterparty(
  theirLines: readonly OwedLine[],
  yourLines: readonly OwedLine[],
  payments: readonly SettledPayment[],
): CounterpartyImputation {
  const ordered = [...payments].sort(creationOrder);
  const yours = impute(
    yourLines,
    ordered.map((one) => ({ amount: one.paid, groupId: one.groupId })),
  );
  const collected = ordered.map((one) => ({
    amount: one.collected,
    groupId: one.groupId,
  }));
  const theirs = impute(theirLines, withoutNewest(collected, yours.surplus));
  const theyGave = collected.reduce(
    (sum, one) => sum + Math.max(0, one.amount),
    0,
  );
  return {
    theirs: theirs.settled,
    yours: yours.settled,
    surplus: {
      theirs: theirs.surplus,
      yours: Math.max(0, yours.surplus - theyGave),
    },
  };
}
