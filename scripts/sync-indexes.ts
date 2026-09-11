// npm run db:sync-indexes — the model list comes from the registry, never a hand-kept one.
import "dotenv/config";
import "../src/infrastructure/models";

import mongoose from "mongoose";

import { connectMongo } from "../src/config/mongoConnection";

async function main(): Promise<void> {
  await connectMongo();
  const models = Object.values(mongoose.models);
  if (models.length === 0) {
    throw new Error("No Mongoose models registered; nothing to sync");
  }
  for (const model of models) {
    await model.syncIndexes();

    console.log(`Synced indexes for ${model.modelName}`);
  }
  await mongoose.disconnect();

  console.log(`Done (${models.length} models).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
