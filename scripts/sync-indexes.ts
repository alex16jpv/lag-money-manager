// Syncs MongoDB indexes to the Mongoose schemas (creates missing, drops removed).
// Run as a deploy step: npm run db:sync-indexes
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../src/config/mongoConnection";
import { UserModel } from "../src/infrastructure/models/UserModel";
import { AccountModel } from "../src/infrastructure/models/AccountModel";
import { CategoryModel } from "../src/infrastructure/models/CategoryModel";
import { TransactionModel } from "../src/infrastructure/models/TransactionModel";
import { RateLimitModel } from "../src/infrastructure/models/RateLimitModel";
import { BudgetModel } from "../src/infrastructure/models/BudgetModel";
import { IdempotencyKeyModel } from "../src/infrastructure/models/IdempotencyKeyModel";

async function main(): Promise<void> {
  await connectMongo();
  const models = [
    UserModel,
    AccountModel,
    CategoryModel,
    TransactionModel,
    RateLimitModel,
    BudgetModel,
    IdempotencyKeyModel,
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
