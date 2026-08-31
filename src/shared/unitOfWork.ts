import mongoose, { ClientSession } from "mongoose";

/**
 * A database session that a set of writes can join so they commit or roll back
 * together. Repositories accept it as an optional argument; passing it makes the
 * write part of the surrounding transaction.
 */
export type TxSession = ClientSession;

/**
 * Runs `fn` inside a MongoDB transaction. Every repository call that receives
 * the provided session participates in the same atomic unit: if `fn` throws,
 * all of its writes roll back together. Requires a replica set (MongoDB Atlas
 * clusters, including the free M0 tier, are replica sets).
 *
 * `session.withTransaction` also transparently retries on transient transaction
 * errors, so the callback must be idempotent (ours only reads then writes).
 */
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
