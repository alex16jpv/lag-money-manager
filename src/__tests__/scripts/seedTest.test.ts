/**
 * The seed is the one piece of this repo that mocks cannot cover: its whole
 * point is that the real services, validations and indexes agree on a known
 * state. So this runs the actual `seed:test` command twice against a local
 * MongoDB — on its own database, never the URI in `.env`, which may well point
 * at production — and checks that the second run lands exactly where the first
 * one did.
 *
 * CI has no Mongo. When the replica set is unreachable the checks report that
 * they were skipped instead of silently passing.
 */
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { MongoClient } from "mongodb";
import { join } from "path";

const TEST_URI =
  "mongodb://localhost:27017/lag_seed_itest?replicaSet=rs0&directConnection=true";
const ROOT = join(__dirname, "../../..");
const OUTPUT = join(ROOT, "scripts/seed-test.output.json");

interface SeedOutput {
  user: { id: string; email: string };
  accounts: Record<string, { id: string; balance: number; archived: boolean }>;
  categories: Record<string, string>;
  budgets: Record<string, string>;
  totals: {
    transactions: number;
    monthSpending: number;
    byCategory: Record<string, number>;
  };
}

const runSeed = (): SeedOutput => {
  execFileSync("npx", ["tsx", "scripts/seed-test.ts"], {
    cwd: ROOT,
    env: { ...process.env, MONGO_URI: TEST_URI, NODE_ENV: "development" },
    stdio: "pipe",
    timeout: 120_000,
  });
  return JSON.parse(readFileSync(OUTPUT, "utf8")) as SeedOutput;
};

describe("seed:test", () => {
  let available = false;
  let first: SeedOutput;
  let second: SeedOutput;
  let counts: Record<string, number>;
  let seededName: string | undefined;

  beforeAll(async () => {
    const client = new MongoClient(TEST_URI, {
      serverSelectionTimeoutMS: 1500,
    });
    try {
      await client.connect();
      available = true;
    } catch {
      await client.close().catch(() => undefined);
      return;
    }

    first = runSeed();
    second = runSeed();

    const db = client.db();
    const scoped = { userId: second.user.id };
    seededName = (
      await db.collection("users").findOne({ email: second.user.email })
    )?.name as string | undefined;
    counts = {
      users: await db
        .collection("users")
        .countDocuments({ email: second.user.email }),
      accounts: await db.collection("accounts").countDocuments(scoped),
      categories: await db.collection("categories").countDocuments(scoped),
      transactions: await db.collection("transactions").countDocuments(scoped),
      budgets: await db.collection("budgets").countDocuments(scoped),
      sessions: await db.collection("refreshsessions").countDocuments(scoped),
    };
    await db.dropDatabase();
    await client.close();
  }, 180_000);

  const ran = (): boolean => {
    if (!available) {
      console.warn("SKIPPED: no MongoDB replica set on localhost:27017");
    }
    return available;
  };

  it("writes the output file the frontend imports", () => {
    if (!ran()) return;
    expect(existsSync(OUTPUT)).toBe(true);
  });

  it("leaves one user, not one per run", () => {
    if (!ran()) return;
    expect(counts.users).toBe(1);
  });

  // Owner decision (2026-09-02): the example user is a neutral placeholder,
  // the same one the front shows.
  it("names the example user John Doe", () => {
    if (!ran()) return;
    expect(seededName).toBe("John Doe");
  });

  it("duplicates nothing on the second run", () => {
    if (!ran()) return;
    expect(counts.accounts).toBe(5);
    expect(counts.categories).toBe(14);
    expect(counts.budgets).toBe(10);
    expect(counts.sessions).toBe(2);
    expect(counts.transactions).toBe(second.totals.transactions);
  });

  it("keeps every id stable across runs", () => {
    if (!ran()) return;
    expect(second.user.id).toBe(first.user.id);
    expect(second.accounts).toEqual(first.accounts);
    expect(second.categories).toEqual(first.categories);
    expect(second.budgets).toEqual(first.budgets);
  });

  it("matches the per-category totals the designs display", () => {
    if (!ran()) return;
    expect(second.totals.byCategory).toEqual({
      food: 412_000,
      lifestyle: 356_000,
      transportation: 185_500,
      "bills-services": 186_200,
      coffee: 98_400,
      uncategorized: 47_900,
    });
    expect(second.totals.monthSpending).toBe(1_286_000);
  });

  it("lands the designed final balances", () => {
    if (!ran()) return;
    expect(second.accounts.bancolombia.balance).toBe(3_420_500);
    expect(second.accounts.cash.balance).toBe(184_000);
    expect(second.accounts.visa.balance).toBe(-1_245_900);
    expect(second.accounts.savings.balance).toBe(8_900_000);
    expect(second.accounts.nequi.archived).toBe(true);
  });
});
