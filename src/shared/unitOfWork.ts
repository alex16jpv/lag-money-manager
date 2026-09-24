import mongoose, { ClientSession } from "mongoose";

export type TxSession = ClientSession;

// Needs a replica set, and retries transient conflicts, so fn must be idempotent.
export async function withTransaction<T>(
  fn: (session: TxSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T;
    // Bounds every attempt and the commit together: the driver's own retry loop runs up to 120 s.
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { timeoutMS: 10_000 },
    );
    return result!;
  } finally {
    await session.endSession();
  }
}
