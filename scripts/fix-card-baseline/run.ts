// Single use (T-90): see the end of this text for what gets deleted once it has run.
import "dotenv/config";
import "../../src/infrastructure/models";

import { readdirSync, statSync } from "fs";
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
  CARD_SKIP_REASONS,
  CardRow,
  CORRECTION_DESCRIPTION,
  databaseFromUri,
  INCOME_SKIP_REASONS,
  IncomeRow,
  judgeBackup,
  LIMIT_ACCOUNT_TYPES,
  parseArgs,
  Plan,
  planCardBaseline,
} from "./plan";

const USAGE = `Usage: MONGO_URI='mongodb+srv://...' npx tsx scripts/fix-card-baseline/run.ts --email=<address> [--apply]

One-off repair (T-90) for cards kept in positive, where the balance was set to
the credit limit instead of to what is owed. For the one user given by --email:

  - every INCOME onto one of that user's cards becomes a one-sided ADJUSTMENT,
    so a simulated card payment stops counting as money earned;
  - every card carried in positive gets an ADJUSTMENT of its credit limit, so
    the balance drops to what is actually owed.

Run it in this order:

  1. MONGO_URI='<uri>' npm run db:backup
  2. MONGO_URI='<uri>' npx tsx scripts/fix-card-baseline/run.ts --email=<address>
  3. the same, with --apply

Nothing is written without --apply. With --apply it also needs the archive from
step 1, in BACKUP_DIR, for that same database, not empty and no older than
BACKUP_MAX_AGE_HOURS (default 24) — the name and date are printed so you can see
which one it found. Then it asks you to type the confirmation.

To undo what it wrote: delete the two kinds of row it created, which are the
ADJUSTMENT rows described «${CORRECTION_DESCRIPTION}» and the incomes it turned
into adjustments (their previous shape is kept in the row's revisions).

Options:
  --email=<address>  the only user this touches; required
  --apply            write the changes (without it, nothing is written)

Environment:
  MONGO_URI              the database to repair. Pass it in front of the command:
                         .env is loaded for the rest of the settings, so leaving
                         it out falls back to whatever .env names
  BACKUP_DIR             where db:backup wrote (default: <repo>/backups)
  BACKUP_MAX_AGE_HOURS   how recent that archive must be (default: 24)`;

const DEFAULT_MAX_AGE_HOURS = 24;

function die(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function money(amount: number, currency: string): string {
  return `${amount.toFixed(currencyDecimals(currency))} ${currency}`;
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

  const takeOne = `Take one first:\n    MONGO_URI='<the same URI>' npm run db:backup`;
  let files: { name: string; size: number }[];
  try {
    files = readdirSync(dir).map((name) => ({
      name,
      size: statSync(join(dir, name)).size,
    }));
  } catch {
    die(`No backup directory at ${dir}. ${takeOne}`);
  }

  const verdict = judgeBackup(files, database, new Date(), maxAgeHours);
  if (verdict.backup) {
    console.log(
      `Backup    ${verdict.backup.name} (${verdict.backup.at.toISOString()}, ` +
        `${verdict.ageHours.toFixed(1)} h old, ${verdict.backup.size} bytes)`,
    );
  }
  if (!verdict.ok) {
    die(`Backup of '${database}' in ${dir}: ${verdict.why}. ${takeOne}`);
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

function report(plan: Plan, cards: CardRow[]): void {
  const nameOf = new Map(cards.map((card) => [card.id, card]));

  console.log("");
  console.log(`Incomes to turn into adjustments: ${plan.incomes.length}`);
  for (const { income, card } of plan.incomes) {
    const category = income.categoryId ? " (loses its category)" : "";
    console.log(
      `    ${income.date.toISOString().slice(0, 10)}  ${money(income.amount, card.currency)}  ` +
        `${card.name}  ${income.description ?? "(no description)"}${category}`,
    );
  }

  if (plan.skippedIncomes.length > 0) {
    console.log("");
    console.log(`Incomes left alone: ${plan.skippedIncomes.length}`);
    for (const { income, reason } of plan.skippedIncomes) {
      const card = nameOf.get(income.toAccountId);
      console.log(
        `    ${income.date.toISOString().slice(0, 10)}  ${income.id}  ` +
          `${card?.name ?? "(unknown account)"}  ${INCOME_SKIP_REASONS[reason]}`,
      );
    }
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
  console.log(`Cards left alone: ${plan.skippedCards.length}`);
  for (const { card, reason } of plan.skippedCards) {
    console.log(
      `    ${card.name} (${card.type})  ${money(card.balance, card.currency)}  ${CARD_SKIP_REASONS[reason]}`,
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
  const written: string[] = [];
  try {
    for (const { income, card } of plan.incomes) {
      await service.updateTransaction(
        income.id,
        { type: "ADJUSTMENT", categoryId: null },
        userId,
        timezone,
      );
      written.push(`income ${income.id} turned into an adjustment`);
      console.log(
        `    income ${income.id} is now an adjustment on ${card.name}`,
      );
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
      written.push(
        `adjustment ${created.id} of ${creditLimit} on ${card.name}`,
      );
      console.log(
        `    ${card.name}: adjustment ${created.id} of ${money(creditLimit, card.currency)}`,
      );
    }
  } catch (err) {
    console.error("");
    console.error(
      `FAILED after ${written.length} write(s). Each one was its own database transaction, so these are in and the rest are not:`,
    );
    for (const line of written) console.error(`    ${line}`);
    console.error(
      "Fix what the error below says and run it again: what is already written is skipped on a second run.",
    );
    throw err;
  }
}

async function verify(plan: Plan): Promise<void> {
  console.log("");
  console.log("==> Balances now");
  let drift = false;
  for (const { card, balanceAfter } of plan.fixes) {
    const doc = await AccountModel.findById(card.id).select("balance").lean();
    if (!doc) {
      drift = true;
      console.log(
        `    ${card.name}: GONE — the account could not be read back`,
      );
      continue;
    }
    const balance = fromCents(doc.balance);
    const expected =
      balance === balanceAfter
        ? ""
        : ` — expected ${money(balanceAfter, card.currency)}, so something else moved this card meanwhile`;
    if (expected) drift = true;
    console.log(
      `    ${card.name}: ${money(balance, card.currency)}${expected}`,
    );
  }
  if (drift) {
    die(
      "A balance is not what the plan said it would be. The adjustments are in and are relative, so the figure is still the old balance minus the limit; check the account before doing anything else.",
    );
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(USAGE);
    die(args);
  }
  const { email, apply: write } = args;

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
    report(plan, cards);

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
    await verify(plan);

    console.log("");
    console.log(
      "Done. Now that it has run, delete scripts/fix-card-baseline/, its test\n" +
        "src/__tests__/scripts/fixCardBaseline.test.ts, and the section «Cards carried\n" +
        "in positive» of docs/modules/accounts.md — the three go together, and leaving\n" +
        "the test behind without the script breaks npm run ci.",
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
