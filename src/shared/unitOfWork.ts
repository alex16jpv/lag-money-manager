import mongoose, { ClientSession } from "mongoose";

export type TxSession = ClientSession;

// Runs fn in a MongoDB transaction (requires a replica set). Retries on
// transient conflicts, so fn must be idempotent.
export async function withTransaction<T>(
  fn: (session: TxSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}
