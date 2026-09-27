// npm run email:unsuppress -- <address> — support lifts a suppression; MONGO_URI chooses the database.
import "dotenv/config";

import mongoose from "mongoose";
import { parseArgs } from "util";

import { connectMongo } from "../src/config/mongoConnection";
import { EmailSuppressionRepository } from "../src/infrastructure/repositories/emailSuppression/EmailSuppressionRepository";
import { hashEmailAddress } from "../src/shared/emailHash";

async function main(): Promise<void> {
  const { positionals } = parseArgs({ allowPositionals: true });
  const [address] = positionals;
  if (positionals.length !== 1 || !address.includes("@")) {
    throw new Error("Usage: npm run email:unsuppress -- <address>");
  }
  await connectMongo();
  try {
    const lifted = await new EmailSuppressionRepository().lift(
      hashEmailAddress(address),
    );
    console.log(
      lifted
        ? "Lifted: email goes to this address again. If it bounces or complains again, it is suppressed again."
        : "This address was not suppressed; nothing changed.",
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
