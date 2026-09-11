import mongoose, { ClientSession } from "mongoose";

export type TxSession = ClientSession;

// Needs a replica set, and retries transient conflicts, so fn must be idempotent.
export async function withTransaction<T>(
  fn: (session: TxSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T;
    // The driver's default retry loop can run ~120 s, longer than the Lambda timeout.
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
