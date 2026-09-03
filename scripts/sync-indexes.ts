// Syncs MongoDB indexes to the Mongoose schemas (creates missing, drops removed).
// Run as a deploy step: npm run db:sync-indexes
//
// The model list comes from the registry, not from a list kept here: a
// hand-maintained one had already lost RefreshSession, so its TTL and
// familyId indexes were never created in production.
import "dotenv/config";
import mongoose from "mongoose";

import { connectMongo } from "../src/config/mongoConnection";
import "../src/infrastructure/models";

async function main(): Promise<void> {
  await connectMongo();
  const models = Object.values(mongoose.models);
  if (models.length === 0) {
    throw new Error("No Mongoose models registered; nothing to sync");
  }
  for (const model of models) {
    await model.syncIndexes();
    // eslint-disable-next-line no-console
    console.log(`Synced indexes for ${model.modelName}`);
  }
  await mongoose.disconnect();
  // eslint-disable-next-line no-console
  console.log(`Done (${models.length} models).`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
