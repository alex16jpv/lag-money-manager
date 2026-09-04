import { ApiError } from "./errors";

/** Set when the client's `id` already named an identical resource: 200, not 201. */
export interface CreateOutcome {
  replayed: boolean;
}

export interface CreateOrReplay<TStored, TResult> {
  clientId?: string;
  outcome?: CreateOutcome;
  // Must be scoped to the owner: reading another user's document leaks it.
  findOwn: (id: string) => Promise<TStored | null>;
  matches: (stored: TStored) => boolean;
  replay: (stored: TStored) => Promise<TResult>;
  create: () => Promise<TResult>;
}

// 11000 raised by the _id index, not by a business uniqueness rule.
export function isDuplicateIdError(err: unknown): boolean {
  const e = err as {
    code?: number;
    keyPattern?: Record<string, unknown>;
    keyValue?: Record<string, unknown>;
  };
  if (e?.code !== 11000) return false;
  const key = e.keyPattern ?? e.keyValue;
  return !!key && Object.keys(key).length === 1 && "_id" in key;
}

// Same message whoever owns the id: the caller must not learn it exists elsewhere.
function idTaken(): ApiError {
  return new ApiError(
    "Conflict",
    "That id is already in use; retry with a new one",
    "ID_TAKEN",
  );
}

/**
 * Creates, or replays the create the client already made under the same id.
 * Without `clientId` the create runs untouched.
 */
export async function createOrReplay<TStored, TResult>(
  op: CreateOrReplay<TStored, TResult>,
): Promise<TResult> {
  const { clientId } = op;
  if (!clientId) return op.create();

  const replayOf = async (stored: TStored): Promise<TResult> => {
    if (!op.matches(stored)) throw idTaken();
    if (op.outcome) op.outcome.replayed = true;
    return op.replay(stored);
  };

  // Checked before creating: a replay must not trip the name or period
  // uniqueness rules the original create already satisfied.
  const existing = await op.findOwn(clientId);
  if (existing) return replayOf(existing);

  try {
    return await op.create();
  } catch (err) {
    if (!isDuplicateIdError(err)) throw err;
    const raced = await op.findOwn(clientId);
    if (!raced) throw idTaken();
    return replayOf(raced);
  }
}
