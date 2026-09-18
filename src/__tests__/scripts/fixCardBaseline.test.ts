// The plan imports the account types from shared/constants, which validates the environment on import.
process.env.JWT_SECRET ??= "fix-card-baseline-test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.MONGO_URI ??= "mongodb://localhost:27017/unused";

import {
  backupAgeHours,
  CardRow,
  databaseFromUri,
  IncomeRow,
  judgeBackup,
  latestBackup,
  parseArgs,
  parseBackupName,
  planCardBaseline,
} from "../../../scripts/fix-card-baseline/plan";

function card(overrides: Partial<CardRow> = {}): CardRow {
  return {
    id: "card-1",
    name: "Nu Credit Card",
    type: "CARD",
    currency: "COP",
    balance: 700,
    creditLimit: 1000,
    archivedAt: null,
    corrected: false,
    ...overrides,
  };
}

function income(overrides: Partial<IncomeRow> = {}): IncomeRow {
  return {
    id: "txn-1",
    date: new Date("2026-09-01T12:00:00Z"),
    amount: 300,
    description: "Card payment",
    categoryId: null,
    toAccountId: "card-1",
    ...overrides,
  };
}

const ARCHIVED = new Date("2026-01-01T00:00:00Z");

describe("planCardBaseline", () => {
  it("drops the credit limit off a card carried in positive", () => {
    const plan = planCardBaseline([card()], []);

    expect(plan.skippedCards).toHaveLength(0);
    expect(plan.fixes).toEqual([
      { card: card(), creditLimit: 1000, balanceAfter: -300 },
    ]);
  });

  it("does not decide for a card whose balance is not positive", () => {
    const maxed = planCardBaseline([card({ balance: 0 })], []);
    const over = planCardBaseline([card({ balance: -50 })], []);

    expect(maxed.fixes).toHaveLength(0);
    expect(maxed.skippedCards[0].reason).toBe("AMBIGUOUS_BALANCE");
    expect(over.skippedCards[0].reason).toBe("AMBIGUOUS_BALANCE");
  });

  it("leaves a card with no usable credit limit", () => {
    const missing = planCardBaseline([card({ creditLimit: null })], []);
    const zero = planCardBaseline([card({ creditLimit: 0 })], []);

    expect(missing.skippedCards[0].reason).toBe("NO_CREDIT_LIMIT");
    expect(zero.skippedCards[0].reason).toBe("NO_CREDIT_LIMIT");
  });

  it("leaves an archived card even when everything else fits", () => {
    const plan = planCardBaseline([card({ archivedAt: ARCHIVED })], []);

    expect(plan.skippedCards[0].reason).toBe("ARCHIVED");
  });

  it("does not subtract the limit twice on a second run", () => {
    const plan = planCardBaseline([card({ corrected: true })], []);

    expect(plan.fixes).toHaveLength(0);
    expect(plan.skippedCards[0].reason).toBe("ALREADY_CORRECTED");
  });

  it("leaves a card nothing was spent on owing nothing", () => {
    const plan = planCardBaseline([card({ balance: 1000 })], []);

    expect(plan.fixes[0].balanceAfter).toBe(0);
  });

  it("takes every income onto a live card, including cards it leaves alone", () => {
    const skipped = card({ id: "card-2", name: "Old card", creditLimit: null });
    const plan = planCardBaseline(
      [card(), skipped],
      [income(), income({ id: "txn-2", toAccountId: "card-2" })],
    );

    expect(plan.incomes.map((fix) => fix.card.id)).toEqual([
      "card-1",
      "card-2",
    ]);
    expect(plan.skippedIncomes).toHaveLength(0);
  });

  it("leaves an income on an archived card: it cannot be rebooked there", () => {
    const plan = planCardBaseline([card({ archivedAt: ARCHIVED })], [income()]);

    expect(plan.incomes).toHaveLength(0);
    expect(plan.skippedIncomes).toEqual([
      { income: income(), reason: "ARCHIVED" },
    ]);
  });

  it("leaves an income whose account is not one of the cards", () => {
    const plan = planCardBaseline(
      [card()],
      [income({ id: "txn-9", toAccountId: "savings-1" })],
    );

    expect(plan.incomes).toHaveLength(0);
    expect(plan.skippedIncomes[0].reason).toBe("UNKNOWN_ACCOUNT");
  });

  it("plans nothing out of nothing", () => {
    expect(planCardBaseline([], [])).toEqual({
      fixes: [],
      skippedCards: [],
      incomes: [],
      skippedIncomes: [],
    });
  });
});

describe("parseArgs", () => {
  it("reads the email and the write flag", () => {
    expect(parseArgs(["--email=Owner@Example.com"])).toEqual({
      email: "owner@example.com",
      apply: false,
    });
    expect(parseArgs(["--email=owner@example.com", "--apply"])).toEqual({
      email: "owner@example.com",
      apply: true,
    });
  });

  it("refuses a run without a user", () => {
    expect(parseArgs([])).toMatch(/--email is required/);
    expect(parseArgs(["--email=", "--apply"])).toMatch(/--email is required/);
  });

  it("refuses an argument it does not know instead of ignoring it", () => {
    expect(parseArgs(["--email=owner@example.com", "--force"])).toBe(
      "Unknown argument: --force",
    );
  });
});

describe("databaseFromUri", () => {
  it("reads the database out of every shape the backup script accepts", () => {
    expect(databaseFromUri("mongodb://localhost:27017/lag_money")).toBe(
      "lag_money",
    );
    expect(
      databaseFromUri(
        "mongodb://localhost:27017/lag_money?replicaSet=rs0&directConnection=true",
      ),
    ).toBe("lag_money");
    expect(
      databaseFromUri("mongodb+srv://user:pass@cluster.mongodb.net/lag_money"),
    ).toBe("lag_money");
  });

  it("refuses a URI that names no database", () => {
    expect(databaseFromUri("mongodb://localhost:27017")).toBeNull();
    expect(databaseFromUri("mongodb+srv://user:pass@cluster.mongodb.net")).toBe(
      null,
    );
  });

  it("refuses what is not a Mongo URI or not a usable name", () => {
    expect(databaseFromUri("postgres://localhost/lag_money")).toBeNull();
    expect(databaseFromUri("mongodb://localhost:27017/lag money")).toBeNull();
    expect(databaseFromUri("mongodb://localhost:27017/")).toBeNull();
  });
});

describe("backups", () => {
  const fresh = "lag_money-2026-09-17T12-46-00Z.archive.gz";
  const now = new Date("2026-09-17T18:46:00Z");

  it("reads the stamp db-backup.sh writes", () => {
    expect(parseBackupName(fresh, "lag_money")).toEqual(
      new Date("2026-09-17T12:46:00Z"),
    );
  });

  it("ignores another database, another shape and a partial file", () => {
    expect(
      parseBackupName("other-2026-09-17T12-46-00Z.archive.gz", "lag_money"),
    ).toBeNull();
    expect(
      parseBackupName("lag_money-2026-09-17.archive.gz", "lag_money"),
    ).toBeNull();
    expect(
      parseBackupName(
        ".lag_money-2026-09-17T12-46-00Z.archive.gz.partial",
        "lag_money",
      ),
    ).toBeNull();
  });

  it("does not let a database name carry a pattern of its own", () => {
    expect(parseBackupName(fresh, ".*")).toBeNull();
  });

  it("picks the newest archive of that database", () => {
    const files = [
      { name: "lag_money-2026-09-15T08-00-00Z.archive.gz", size: 10 },
      { name: fresh, size: 20 },
      { name: "lag_money-2026-09-16T23-59-59Z.archive.gz", size: 30 },
      { name: "lag_money_test-2026-09-18T00-00-00Z.archive.gz", size: 40 },
      { name: "notes.txt", size: 50 },
    ];

    expect(latestBackup(files, "lag_money")).toEqual({
      name: fresh,
      size: 20,
      at: new Date("2026-09-17T12:46:00Z"),
    });
  });

  it("finds nothing when no archive belongs to that database", () => {
    expect(latestBackup([{ name: "notes.txt", size: 1 }], "lag_money")).toBe(
      null,
    );
    expect(latestBackup([], "lag_money")).toBeNull();
  });

  it("measures the age in hours", () => {
    expect(
      backupAgeHours(
        new Date("2026-09-17T00:00:00Z"),
        new Date("2026-09-17T06:30:00Z"),
      ),
    ).toBe(6.5);
  });

  it("accepts a recent archive that has something in it", () => {
    const verdict = judgeBackup(
      [{ name: fresh, size: 4096 }],
      "lag_money",
      now,
      24,
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.ageHours).toBe(6);
  });

  it("refuses when there is no archive of that database", () => {
    const verdict = judgeBackup([], "lag_money", now, 24);

    expect(verdict).toMatchObject({ ok: false, backup: null });
  });

  it("refuses an archive that is only a name", () => {
    const verdict = judgeBackup(
      [{ name: fresh, size: 0 }],
      "lag_money",
      now,
      24,
    );

    expect(verdict).toMatchObject({
      ok: false,
      why: expect.stringContaining("empty"),
    });
  });

  it("refuses an archive older than the limit", () => {
    const verdict = judgeBackup(
      [{ name: fresh, size: 4096 }],
      "lag_money",
      now,
      4,
    );

    expect(verdict).toMatchObject({
      ok: false,
      why: expect.stringContaining("older"),
    });
    expect(verdict.backup?.name).toBe(fresh);
  });
});
