/**
 * Creates/updates all MongoDB indexes to match the Mongoose schemas, then exits.
 *
 * Run this once after deploying schema/index changes:
 *   npm run db:sync-indexes
 *
 * Why a script instead of relying on autoIndex: Mongoose builds indexes
 * automatically on first model use when `autoIndex` is on (the default), which
 * is convenient in development but risky in production (index builds triggered
 * by live traffic, and no signal when they finish). Running `syncIndexes()`
 * deliberately — as a deploy step — creates missing indexes, drops ones no
 * longer declared, and lets you see it complete before shifting traffic.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../src/config/mongoConnection";
import { UserModel } from "../src/domain/models/UserModel";
import { AccountModel } from "../src/domain/models/AccountModel";
import { CategoryModel } from "../src/domain/models/CategoryModel";
import { TransactionModel } from "../src/domain/models/TransactionModel";
import { RateLimitModel } from "../src/domain/models/RateLimitModel";

async function main(): Promise<void> {
  await connectMongo();
  const models = [
    UserModel,
    AccountModel,
    CategoryModel,
    TransactionModel,
    RateLimitModel,
  ];
  for (const model of models) {
    await model.syncIndexes();
    // eslint-disable-next-line no-console
    console.log(`Synced indexes for ${model.modelName}`);
  }
  await mongoose.disconnect();
  // eslint-disable-next-line no-console
  console.log("Done.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
