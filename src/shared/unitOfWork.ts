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
    // Bounded commit: the driver's default retry loop can run up to ~120s,
    // longer than the Lambda timeout — better to fail the request cleanly.
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { maxCommitTimeMS: 10_000 },
    );
    return result!;
  } finally {
    await session.endSession();
  }
}
