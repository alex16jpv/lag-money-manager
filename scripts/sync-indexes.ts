// Syncs MongoDB indexes to the Mongoose schemas (creates missing, drops removed).
// Run as a deploy step: npm run db:sync-indexes
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
