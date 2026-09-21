import { DomainValidationError } from "../../domain/errors";
import {
  SharedExpense,
  SharedSplit,
} from "../../domain/entities/SharedExpense";
import {
  DefaultSplit,
  SharedGroup,
  SharedParticipant,
} from "../../domain/entities/SharedGroup";
import { SHARE_PARTIES, SPLIT_MODES, SplitMode } from "../../shared/constants";
import { resolveShares, SplitRow } from "../../shared/splitShares";
import { DefaultSplitDTO } from "../dtos/SharedGroupDTO";
import { SplitDTO, SplitShareDTO } from "../dtos/SharedExpenseDTO";

const invalid = (message: string): DomainValidationError =>
  new DomainValidationError(message, "split", "SPLIT_INVALID");

const PERCENT_TOTAL = 100;
const PERCENT_SCALE = 100;

const keyOf = (share: { party: string; contactId: string | null }): string =>
  share.party === SHARE_PARTIES.CONTACT
    ? `contact:${share.contactId}`
    : share.party;

const participantKeys = (participants: SharedParticipant[]): Set<string> =>
  new Set(
    participants.map((p) =>
      p.contactId === null ? SHARE_PARTIES.USER : `contact:${p.contactId}`,
    ),
  );

/** The payer's row, which is the one that absorbs the odd minor unit. */
function payerIndexOf(
  shares: { party: string; contactId: string | null }[],
  paidByContactId: string | null,
): number {
  const index = shares.findIndex((share) =>
    paidByContactId === null
      ? share.party === SHARE_PARTIES.USER
      : share.party === SHARE_PARTIES.CONTACT &&
        share.contactId === paidByContactId,
  );
  if (index === -1) {
    throw invalid("Whoever paid has to have a share of the expense");
  }
  return index;
}

function assertInputsMatchMode(mode: SplitMode, shares: SplitShareDTO[]): void {
  for (const share of shares) {
    const hasPercent = share.percent !== undefined && share.percent !== null;
    const hasAmount =
      share.fixedAmount !== undefined && share.fixedAmount !== null;
    if (mode === SPLIT_MODES.PERCENT && (!hasPercent || hasAmount)) {
      throw invalid("A percentage split takes a percentage on every share");
    }
    if (mode === SPLIT_MODES.EXACT && (!hasAmount || hasPercent)) {
      throw invalid("An exact split takes an amount on every share");
    }
    if (mode === SPLIT_MODES.FIXED_REST && hasPercent) {
      throw invalid("A fixed-plus-rest split takes amounts, not percentages");
    }
    if (mode === SPLIT_MODES.EQUAL && (hasPercent || hasAmount)) {
      throw invalid("An equal split takes no figures");
    }
  }
}

function assertShapeOfShares(
  shares: SplitShareDTO[],
  participants: SharedParticipant[],
): void {
  if (shares.length === 0) {
    throw invalid("A split needs at least one share");
  }
  const allowed = participantKeys(participants);
  const seen = new Set<string>();
  let guestRows = 0;
  for (const share of shares) {
    if (share.party === SHARE_PARTIES.GUESTS) {
      guestRows += 1;
      continue;
    }
    if (share.party === SHARE_PARTIES.CONTACT && !share.contactId) {
      throw invalid("A contact share has to name the contact");
    }
    if (share.party === SHARE_PARTIES.USER && share.contactId) {
      throw invalid("Your own share names nobody else");
    }
    const key = keyOf({
      party: share.party,
      contactId: share.contactId ?? null,
    });
    if (seen.has(key)) {
      throw invalid("Somebody appears twice in the same split");
    }
    seen.add(key);
    if (!allowed.has(key)) {
      throw new DomainValidationError(
        "That person is not in this shared group",
        "split.shares",
        "PARTICIPANT_NOT_IN_GROUP",
      );
    }
  }
  if (guestRows > 1) {
    throw invalid("An expense carries a single block of guests");
  }
}

function assertGuestsAgree(split: SplitDTO): void {
  const guestRows = split.shares.filter(
    (share) => share.party === SHARE_PARTIES.GUESTS,
  ).length;
  const hasBlock = Boolean(split.guests);
  if (hasBlock && guestRows !== 1) {
    throw invalid("A block of guests needs its own share");
  }
  if (!hasBlock && guestRows > 0) {
    throw invalid("A guest share needs the head count above the rows");
  }
}

const unitsOf = (share: SplitShareDTO, guestCount: number): number =>
  share.party === SHARE_PARTIES.GUESTS ? guestCount : 1;

const inputOf = (mode: SplitMode, share: SplitShareDTO): number | null => {
  if (mode === SPLIT_MODES.PERCENT) return share.percent ?? null;
  if (mode === SPLIT_MODES.EQUAL) return null;
  return share.fixedAmount ?? null;
};

/** Turns a split as the client stated it into the split as it is stored, with every share resolved. */
export function buildSplit(input: {
  split: SplitDTO;
  participants: SharedParticipant[];
  amount: number;
  currency: string;
  paidByContactId: string | null;
}): SharedSplit {
  assertShapeOfShares(input.split.shares, input.participants);
  return resolveStated(input);
}

/** The same thing over a stated split whose people are already known to be in the group. */
function resolveStated(input: {
  split: SplitDTO;
  amount: number;
  currency: string;
  paidByContactId: string | null;
}): SharedSplit {
  const { split, amount, currency, paidByContactId } = input;
  assertGuestsAgree(split);
  assertInputsMatchMode(split.mode, split.shares);

  const guestCount = split.guests?.count ?? 0;
  const rows: SplitRow[] = split.shares.map((share) => ({
    units: unitsOf(share, guestCount),
    input: inputOf(split.mode, share),
  }));
  const payerIndex = payerIndexOf(
    split.shares.map((share) => ({
      party: share.party,
      contactId: share.contactId ?? null,
    })),
    paidByContactId,
  );

  const amounts = resolveShares({
    total: amount,
    currency,
    mode: split.mode,
    rows,
    payerIndex,
  });

  return {
    mode: split.mode,
    guests: split.guests
      ? { count: split.guests.count, name: split.guests.name ?? null }
      : null,
    shares: split.shares.map((share, index) => ({
      party: share.party,
      contactId:
        share.party === SHARE_PARTIES.CONTACT
          ? (share.contactId ?? null)
          : null,
      percent:
        split.mode === SPLIT_MODES.PERCENT ? (share.percent ?? null) : null,
      fixedAmount:
        split.mode === SPLIT_MODES.EXACT ||
        split.mode === SPLIT_MODES.FIXED_REST
          ? (share.fixedAmount ?? null)
          : null,
      amount: amounts[index] as number,
    })),
  };
}

/** A stored split restated as its input: what a request states, without the resolved amounts. */
export function statedSplitOf(split: SharedSplit): SplitDTO {
  return {
    mode: split.mode,
    guests: split.guests ?? null,
    shares: split.shares.map((share) => ({
      party: share.party,
      contactId: share.contactId ?? null,
      percent: split.mode === SPLIT_MODES.PERCENT ? share.percent : null,
      fixedAmount:
        split.mode === SPLIT_MODES.PERCENT ? null : share.fixedAmount,
    })),
  };
}

/** The same split over another total; EXACT states figures, so they stop adding up and it throws. */
export function resplitForNewAmount(input: {
  split: SharedSplit;
  amount: number;
  currency: string;
  paidByContactId: string | null;
}): SharedSplit {
  return resolveStated({
    split: statedSplitOf(input.split),
    amount: input.amount,
    currency: input.currency,
    paidByContactId: input.paidByContactId,
  });
}

const percentFor = (
  defaultSplit: DefaultSplit,
  contactId: string | null,
): number => {
  const row = defaultSplit.shares.find((s) => s.contactId === contactId);
  if (!row) {
    throw invalid("The group's default split does not cover everybody in it");
  }
  return row.percent;
};

/** The split an expense inherits from its group, without asking. */
export function inheritedSplit(input: {
  group: SharedGroup;
  amount: number;
  currency: string;
  paidByContactId: string | null;
}): SharedSplit {
  const { group, amount, currency, paidByContactId } = input;
  const equal = group.defaultSplit.mode === SPLIT_MODES.EQUAL;
  return buildSplit({
    split: {
      mode: group.defaultSplit.mode,
      guests: null,
      shares: group.participants.map((participant) => ({
        party:
          participant.contactId === null
            ? SHARE_PARTIES.USER
            : SHARE_PARTIES.CONTACT,
        contactId: participant.contactId,
        percent: equal
          ? null
          : percentFor(group.defaultSplit, participant.contactId),
      })),
    },
    participants: group.participants,
    amount,
    currency,
    paidByContactId,
  });
}

/**
 * The split of an existing expense once the group has new participants.
 * Returns null when the expense keeps the split it has.
 */
export function resplitForNewParticipants(input: {
  expense: SharedExpense;
  group: SharedGroup;
  newContactIds: string[];
  currency: string;
}): SharedSplit | null {
  const { expense, group, newContactIds, currency } = input;
  if (!expense.customSplit) {
    return inheritedSplit({
      group,
      amount: expense.amount,
      currency,
      paidByContactId: expense.paidByContactId,
    });
  }
  // A percentage or an amount for somebody who was not there would be invented, not derived.
  if (
    expense.split.mode === SPLIT_MODES.PERCENT ||
    expense.split.mode === SPLIT_MODES.EXACT
  ) {
    return null;
  }
  const shares: SplitShareDTO[] = [
    ...expense.split.shares.map((share) => ({
      party: share.party,
      contactId: share.contactId,
      fixedAmount: share.fixedAmount,
    })),
    ...newContactIds.map((contactId) => ({
      party: SHARE_PARTIES.CONTACT,
      contactId,
      fixedAmount: null,
    })),
  ];
  return buildSplit({
    split: { mode: expense.split.mode, guests: expense.split.guests, shares },
    participants: group.participants,
    amount: expense.amount,
    currency,
    paidByContactId: expense.paidByContactId,
  });
}

/** What the group's default split may say, given who is in the group. */
export function assertDefaultSplit(
  defaultSplit: DefaultSplitDTO,
  participants: SharedParticipant[],
): DefaultSplit {
  if (defaultSplit.mode === SPLIT_MODES.EQUAL) {
    return { mode: defaultSplit.mode, shares: [] };
  }
  const shares = defaultSplit.shares ?? [];
  if (shares.length !== participants.length) {
    throw invalid("The group's default split needs one percentage per person");
  }
  const expected = participantKeys(participants);
  const seen = new Set<string>();
  for (const share of shares) {
    const key =
      share.contactId === null
        ? SHARE_PARTIES.USER
        : `contact:${share.contactId}`;
    if (seen.has(key) || !expected.has(key)) {
      throw invalid("The group's default split does not cover everybody in it");
    }
    seen.add(key);
  }
  const basisPoints = shares.reduce(
    (sum, share) => sum + Math.round(share.percent * PERCENT_SCALE),
    0,
  );
  if (basisPoints !== PERCENT_TOTAL * PERCENT_SCALE) {
    throw invalid("The percentages of a split must add up to 100");
  }
  return { mode: defaultSplit.mode, shares };
}

/**
 * What each person is down for across a whole group, keyed by contact id and
 * `null` for the user, so a change can be shown before it happens. Guests are
 * left out: a block belongs to one expense and does not add up across them.
 */
export function sharesByParticipant(
  expenses: { split: SharedSplit }[],
): Map<string | null, number> {
  const totals = new Map<string | null, number>();
  for (const expense of expenses) {
    for (const share of expense.split.shares) {
      if (share.party === SHARE_PARTIES.GUESTS) continue;
      const key = share.party === SHARE_PARTIES.USER ? null : share.contactId;
      totals.set(key, (totals.get(key) ?? 0) + share.amount);
    }
  }
  return totals;
}

// Largest remainder, so what is left still adds up to exactly 100.
export function rescaleDefaultSplit(
  defaultSplit: DefaultSplit,
  removedContactId: string,
): DefaultSplit {
  if (defaultSplit.mode === SPLIT_MODES.EQUAL) {
    return { mode: defaultSplit.mode, shares: [] };
  }
  const kept = defaultSplit.shares.filter(
    (share) => share.contactId !== removedContactId,
  );
  if (kept.length === 0) {
    return defaultSplit;
  }
  const whole = PERCENT_TOTAL * PERCENT_SCALE;
  const points = kept.map((share) => Math.round(share.percent * PERCENT_SCALE));
  const sum = points.reduce((total, point) => total + point, 0);
  const scaled = kept.map((_, index) =>
    sum === 0 ? whole / kept.length : (points[index] as number) * (whole / sum),
  );
  const floors = scaled.map((value) => Math.floor(value));
  let left = whole - floors.reduce((total, value) => total + value, 0);
  const order = scaled
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] = (floors[index] as number) + 1;
    left -= 1;
  }
  return {
    mode: defaultSplit.mode,
    shares: kept.map((share, index) => ({
      contactId: share.contactId,
      percent: (floors[index] as number) / PERCENT_SCALE,
    })),
  };
}
