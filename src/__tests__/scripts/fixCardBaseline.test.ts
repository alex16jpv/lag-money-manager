// The plan imports the account types from shared/constants, which validates the environment on import.
process.env.JWT_SECRET ??= "fix-card-baseline-test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.MONGO_URI ??= "mongodb://localhost:27017/unused";

import {
  backupAgeHours,
  CardRow,
  databaseFromUri,
  IncomeRow,
  latestBackup,
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

describe("planCardBaseline", () => {
  it("drops the credit limit off a card carried in positive", () => {
    const plan = planCardBaseline([card()], []);

    expect(plan.skipped).toHaveLength(0);
    expect(plan.fixes).toEqual([
      { card: card(), creditLimit: 1000, balanceAfter: -300 },
    ]);
  });

  it("leaves a card whose balance already reads as debt", () => {
    const plan = planCardBaseline([card({ balance: -300 })], []);

    expect(plan.fixes).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("NOT_IN_POSITIVE");
  });

  it("leaves a card with no usable credit limit", () => {
    const missing = planCardBaseline([card({ creditLimit: null })], []);
    const zero = planCardBaseline([card({ creditLimit: 0 })], []);

    expect(missing.skipped[0].reason).toBe("NO_CREDIT_LIMIT");
    expect(zero.skipped[0].reason).toBe("NO_CREDIT_LIMIT");
  });

  it("leaves an archived card even when everything else fits", () => {
    const plan = planCardBaseline(
      [card({ archivedAt: new Date("2026-01-01T00:00:00Z") })],
      [],
    );

    expect(plan.skipped[0].reason).toBe("ARCHIVED");
  });

  it("does not subtract the limit twice on a second run", () => {
    const plan = planCardBaseline([card({ corrected: true })], []);

    expect(plan.fixes).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("ALREADY_CORRECTED");
  });

  it("splits a balance exactly at the limit into a zero balance", () => {
    const plan = planCardBaseline([card({ balance: 1000 })], []);

    expect(plan.fixes[0].balanceAfter).toBe(0);
  });

  it("takes every income onto a card, including cards it leaves alone", () => {
    const skipped = card({ id: "card-2", name: "Old card", creditLimit: null });
    const plan = planCardBaseline(
      [card(), skipped],
      [income(), income({ id: "txn-2", toAccountId: "card-2" })],
    );

    expect(plan.incomes.map((fix) => fix.card.id)).toEqual([
      "card-1",
      "card-2",
    ]);
  });

  it("reports an income whose account is not one of the cards", () => {
    const plan = planCardBaseline(
      [card()],
      [income({ id: "txn-9", toAccountId: "savings-1" })],
    );

    expect(plan.incomes).toHaveLength(0);
    expect(plan.unmatchedIncomes.map((row) => row.id)).toEqual(["txn-9"]);
  });

  it("plans nothing out of nothing", () => {
    expect(planCardBaseline([], [])).toEqual({
      fixes: [],
      skipped: [],
      incomes: [],
      unmatchedIncomes: [],
    });
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
  it("reads the stamp db-backup.sh writes", () => {
    expect(
      parseBackupName("lag_money-2026-09-17T12-46-00Z.archive.gz", "lag_money"),
    ).toEqual(new Date("2026-09-17T12:46:00Z"));
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
    expect(
      parseBackupName("lag_money-2026-09-17T12-46-00Z.archive.gz", ".*"),
    ).toBeNull();
  });

  it("picks the newest archive of that database", () => {
    const names = [
      "lag_money-2026-09-15T08-00-00Z.archive.gz",
      "lag_money-2026-09-17T12-46-00Z.archive.gz",
      "lag_money-2026-09-16T23-59-59Z.archive.gz",
      "lag_money_test-2026-09-18T00-00-00Z.archive.gz",
      "notes.txt",
    ];

    expect(latestBackup(names, "lag_money")).toEqual({
      name: "lag_money-2026-09-17T12-46-00Z.archive.gz",
      at: new Date("2026-09-17T12:46:00Z"),
    });
  });

  it("finds nothing when no archive belongs to that database", () => {
    expect(latestBackup(["notes.txt"], "lag_money")).toBeNull();
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
});
