import { ApiError } from "./errors";

/** Set when the client's `id` already named one of the user's resources: 200, not 201. */
export interface CreateOutcome {
  replayed: boolean;
}

export interface CreateOrReplay<TStored, TResult> {
  clientId?: string;
  outcome?: CreateOutcome;
  // Must be scoped to the owner: reading another user's document leaks it.
  findOwn: (id: string) => Promise<TStored | null>;
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

// Only ever raised for another user's id, and worded so the caller cannot tell it exists.
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
 *
 * A create is "make sure this entity exists" (offline plan, invariant 3), so an
 * id the user already owns replays whatever the payload says now: the row may
 * have been edited from another device between the lost response and the
 * retry, and answering 409 there would make the client mint a second id and
 * create a duplicate. 409 ID_TAKEN is reserved for an id that is not the
 * user's, which is the only case where "mint another one" is the right move.
 */
export async function createOrReplay<TStored, TResult>(
  op: CreateOrReplay<TStored, TResult>,
): Promise<TResult> {
  const { clientId } = op;
  if (!clientId) return op.create();

  const replayOf = async (stored: TStored): Promise<TResult> => {
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
