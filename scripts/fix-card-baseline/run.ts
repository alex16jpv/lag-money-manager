// Single use (T-90): delete this folder once it has run.
import "dotenv/config";
import "../../src/infrastructure/models";

import { readdirSync } from "fs";
import mongoose from "mongoose";
import { join } from "path";
import { createInterface } from "readline";

import { TransactionService } from "../../src/app/services/TransactionService";
import { AccountModel } from "../../src/infrastructure/models/AccountModel";
import { TransactionModel } from "../../src/infrastructure/models/TransactionModel";
import { UserModel } from "../../src/infrastructure/models/UserModel";
import { AccountRepository } from "../../src/infrastructure/repositories/account/AccountRepository";
import { CategoryRepository } from "../../src/infrastructure/repositories/category/CategoryRepository";
import { IdempotencyRepository } from "../../src/infrastructure/repositories/idempotency/IdempotencyRepository";
import { TransactionRepository } from "../../src/infrastructure/repositories/transaction/TransactionRepository";
import { ENVIRONMENT } from "../../src/shared/constants";
import { currencyDecimals } from "../../src/shared/currency";
import { fromCents } from "../../src/shared/money";
import {
  backupAgeHours,
  CardRow,
  CORRECTION_DESCRIPTION,
  databaseFromUri,
  IncomeRow,
  latestBackup,
  LIMIT_ACCOUNT_TYPES,
  Plan,
  planCardBaseline,
  SKIP_REASONS,
} from "./plan";

const USAGE = `Usage: MONGO_URI='mongodb+srv://...' npx tsx scripts/fix-card-baseline/run.ts --email=<address> [--apply]

One-off repair (T-90) for cards kept in positive, where the balance was set to
the credit limit instead of to what is owed. For the one user given by --email:

  - every INCOME onto one of that user's cards becomes a one-sided ADJUSTMENT,
    so a simulated card payment stops counting as money earned;
  - every card carried in positive gets an ADJUSTMENT of its credit limit, so
    the balance drops to what is actually owed.

Nothing is written without --apply. With --apply it also needs a backup from
npm run db:backup, no older than BACKUP_MAX_AGE_HOURS (default 24), and a typed
confirmation.

Options:
  --email=<address>  the only user this touches; required
  --apply            write the changes (without it, nothing is written)

Environment:
  MONGO_URI              the database to repair; read from the environment only
  BACKUP_DIR             where db:backup writes (default: <repo>/backups)
  BACKUP_MAX_AGE_HOURS   how recent the backup must be (default: 24)`;

const DEFAULT_MAX_AGE_HOURS = 24;

function die(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function money(amount: number, currency: string): string {
  return `${amount.toFixed(currencyDecimals(currency))} ${currency}`;
}

function parseArgs(argv: string[]): { email: string; apply: boolean } {
  let email = "";
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg.startsWith("--email=")) {
      email = arg.slice("--email=".length).trim();
    } else {
      console.error(USAGE);
      die(`Unknown argument: ${arg}`);
    }
  }
  if (!email) {
    console.error(USAGE);
    die("--email is required: this repair is scoped to a single user.");
  }
  return { email: email.toLowerCase(), apply };
}

async function confirm(question: string, expected: string): Promise<void> {
  if (!process.stdin.isTTY) {
    die(
      "This command writes data and asks for confirmation; run it from a terminal.",
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) =>
    rl.question(question, resolve),
  );
  rl.close();
  if (answer.trim() !== expected) {
    die(`Answered '${answer.trim()}', not '${expected}'. Nothing was written.`);
  }
}

function assertRecentBackup(database: string): void {
  const dir = process.env.BACKUP_DIR ?? join(__dirname, "..", "..", "backups");
  const maxAgeHours = Number(
    process.env.BACKUP_MAX_AGE_HOURS ?? DEFAULT_MAX_AGE_HOURS,
  );
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    die(
      `BACKUP_MAX_AGE_HOURS is not a positive number: ${process.env.BACKUP_MAX_AGE_HOURS}`,
    );
  }

  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    die(
      `No backup directory at ${dir}. Take one first:\n` +
        `    MONGO_URI='<the same URI>' npm run db:backup`,
    );
  }

  const backup = latestBackup(names, database);
  if (!backup) {
    die(
      `No backup of '${database}' in ${dir}. Take one first:\n` +
        `    MONGO_URI='<the same URI>' npm run db:backup`,
    );
  }
  const ageHours = backupAgeHours(backup.at, new Date());
  console.log(
    `Backup    ${backup.name} (${backup.at.toISOString()}, ${ageHours.toFixed(1)} h old)`,
  );
  if (ageHours > maxAgeHours) {
    die(
      `That backup is older than ${maxAgeHours} h. Take a fresh one:\n` +
        `    MONGO_URI='<the same URI>' npm run db:backup`,
    );
  }
}

async function readCards(userId: string): Promise<CardRow[]> {
  const docs = await AccountModel.find({
    userId,
    type: { $in: LIMIT_ACCOUNT_TYPES },
  })
    .sort({ name: 1 })
    .lean();
  const corrected = new Set(
    await TransactionModel.distinct("fromAccountId", {
      userId,
      type: "ADJUSTMENT",
      deletedAt: null,
      description: CORRECTION_DESCRIPTION,
    }),
  );
  return docs.map((doc) => ({
    id: doc._id,
    name: doc.name,
    type: doc.type,
    currency: doc.currency,
    balance: fromCents(doc.balance),
    creditLimit:
      doc.creditLimit === null || doc.creditLimit === undefined
        ? null
        : fromCents(doc.creditLimit),
    archivedAt: doc.archivedAt,
    corrected: corrected.has(doc._id),
  }));
}

async function readIncomes(
  userId: string,
  cardIds: string[],
): Promise<IncomeRow[]> {
  const docs = await TransactionModel.find({
    userId,
    type: "INCOME",
    deletedAt: null,
    toAccountId: { $in: cardIds },
  })
    .sort({ date: 1 })
    .lean();
  return docs.map((doc) => ({
    id: doc._id,
    date: doc.date,
    amount: fromCents(doc.amount),
    description: doc.description,
    categoryId: doc.categoryId,
    toAccountId: doc.toAccountId as string,
  }));
}

function report(plan: Plan): void {
  console.log("");
  console.log(`Incomes to turn into adjustments: ${plan.incomes.length}`);
  for (const { income, card } of plan.incomes) {
    const category = income.categoryId ? " (loses its category)" : "";
    console.log(
      `    ${income.date.toISOString().slice(0, 10)}  ${money(income.amount, card.currency)}  ` +
        `${card.name}  ${income.description ?? "(no description)"}${category}`,
    );
  }
  for (const income of plan.unmatchedIncomes) {
    console.log(
      `    SKIPPED ${income.id}: its account is not one of this user's cards`,
    );
  }

  console.log("");
  console.log(`Cards to bring down to what is owed: ${plan.fixes.length}`);
  for (const { card, creditLimit, balanceAfter } of plan.fixes) {
    console.log(
      `    ${card.name} (${card.type})  ${money(card.balance, card.currency)} ` +
        `- ${money(creditLimit, card.currency)} = ${money(balanceAfter, card.currency)}`,
    );
  }

  console.log("");
  console.log(`Cards left alone: ${plan.skipped.length}`);
  for (const { card, reason } of plan.skipped) {
    console.log(
      `    ${card.name} (${card.type})  ${money(card.balance, card.currency)}  ${SKIP_REASONS[reason]}`,
    );
  }
}

async function apply(
  plan: Plan,
  service: TransactionService,
  userId: string,
  timezone: string,
): Promise<void> {
  console.log("");
  console.log("==> Writing");
  for (const { income, card } of plan.incomes) {
    await service.updateTransaction(
      income.id,
      { type: "ADJUSTMENT", categoryId: null },
      userId,
      timezone,
    );
    console.log(`    income ${income.id} is now an adjustment on ${card.name}`);
  }
  for (const { card, creditLimit } of plan.fixes) {
    const created = await service.createTransaction(
      {
        type: "ADJUSTMENT",
        amount: creditLimit,
        date: new Date(),
        description: CORRECTION_DESCRIPTION,
        fromAccountId: card.id,
        userId,
      },
      timezone,
    );
    console.log(
      `    ${card.name}: adjustment ${created.id} of ${money(creditLimit, card.currency)}`,
    );
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const { email, apply: write } = parseArgs(process.argv.slice(2));

  const uri = (ENVIRONMENT as { MONGO_URI: string }).MONGO_URI;
  const database = databaseFromUri(uri);
  if (!database) {
    die(
      "MONGO_URI names no database. Append /<database> so the repair is scoped to it.",
    );
  }
  const host = uri
    .replace(/^mongodb(\+srv)?:\/\/([^@]*@)?/, "")
    .split(/[/,?]/)[0];

  // A repair run must not create indexes on a live database.
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: false,
  });

  try {
    const user = await UserModel.findOne({ email, deletedAt: null })
      .select("_id timezone")
      .lean();
    if (!user) {
      die(`No active user with email ${email} in '${database}'.`);
    }

    console.log(`Database  ${database} on ${host}`);
    console.log(`User      ${email} (${user._id})`);
    console.log(
      `Mode      ${write ? "APPLY: this writes" : "dry run: nothing is written"}`,
    );

    const cards = await readCards(user._id);
    const incomes = await readIncomes(
      user._id,
      cards.map((card) => card.id),
    );
    const plan = planCardBaseline(cards, incomes);
    report(plan);

    if (plan.fixes.length === 0 && plan.incomes.length === 0) {
      console.log("");
      console.log("Nothing to do.");
      return;
    }

    if (!write) {
      console.log("");
      console.log(
        "Dry run: nothing was written. Re-run with --apply to write it.",
      );
      return;
    }

    console.log("");
    assertRecentBackup(database);
    console.log("");
    await confirm(
      `Write ${plan.incomes.length} adjustment(s) and ${plan.fixes.length} correction(s) to '${database}' on ${host}? [yes/no]: `,
      "yes",
    );

    // Built by hand, not from the factory: importing it opens a second connection that builds indexes.
    const service = new TransactionService(
      new TransactionRepository(),
      new AccountRepository(),
      new IdempotencyRepository(),
      new CategoryRepository(),
    );
    await apply(plan, service, user._id, user.timezone);

    console.log("");
    console.log("==> Balances now");
    for (const { card } of plan.fixes) {
      const doc = await AccountModel.findById(card.id).select("balance").lean();
      console.log(
        `    ${card.name}: ${money(fromCents(doc?.balance ?? 0), card.currency)}`,
      );
    }
    console.log("");
    console.log("Done. Delete scripts/fix-card-baseline/ now that it has run.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
