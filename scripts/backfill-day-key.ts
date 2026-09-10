// Fills `dayKey` on transactions written before the field existed, using the
// timezone of each row's owner: npm run db:backfill-day-key [-- --dry-run]
//
// Until it runs, a calendar window still answers those rows through the legacy
// branch of the filter (their instant), so nothing disappears — but their day
// is not frozen yet, which is the whole point of the field.
import "dotenv/config";
import "../src/infrastructure/models";

import mongoose from "mongoose";

import { connectMongo } from "../src/config/mongoConnection";
import { TransactionModel } from "../src/infrastructure/models/TransactionModel";
import { UserModel } from "../src/infrastructure/models/UserModel";
import { dayKeyOf } from "../src/shared/dayKey";
import { DEFAULT_TIMEZONE } from "../src/shared/timezone";

const BATCH = 500;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  await connectMongo();

  const pending = await TransactionModel.countDocuments({ dayKey: null });
  console.log(`${pending} transactions without an accounting day.`);

  const zones = new Map<string, string>();
  let written = 0;
  let cursor: string | undefined;

  for (;;) {
    const docs = await TransactionModel.find({
      dayKey: null,
      ...(cursor ? { _id: { $gt: cursor } } : {}),
    })
      .sort({ _id: 1 })
      .limit(BATCH)
      .select("_id userId date")
      .lean();
    const last = docs[docs.length - 1];
    if (!last) break;
    cursor = last._id;

    const writes = [];
    for (const doc of docs) {
      let zone = zones.get(doc.userId);
      if (!zone) {
        const owner = await UserModel.findById(doc.userId)
          .select("timezone")
          .lean();
        // A row whose owner is gone keeps the deployment's default: the day it
        // gets is the one every read has been deriving for it anyway.
        zone = owner?.timezone ?? DEFAULT_TIMEZONE;
        zones.set(doc.userId, zone);
      }
      writes.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { dayKey: dayKeyOf(doc.date, zone) } },
        },
      });
    }

    if (!dryRun) {
      // No timestamps: filling a derived field is not an edit the client should see as a change.
      await TransactionModel.bulkWrite(writes, { timestamps: false });
    }
    written += writes.length;
    console.log(`${written}/${pending}`);
  }

  await mongoose.disconnect();
  console.log(
    dryRun
      ? `Dry run: ${written} would be filled.`
      : `Done: ${written} filled.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
