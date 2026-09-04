/**
 * The parity contract: `auditoria/offline-fixtures/*.json` says what the
 * figures are, and this checks the API against it on a real mongod.
 *
 * The expected block was produced by a second, independent reading of the
 * rules (`scripts/offline-fixtures/derive.ts`, no database). Here the same
 * rows go through the real services and the real aggregations. When the two
 * disagree, one of them is wrong and the fixture is not a contract yet —
 * which is the whole point of the file, since the frontend's local
 * derivations (O-F3) are the third implementation to meet it.
 *
 * Mocks cannot stand in: `$dateToString` with a timezone, `$facet`, the
 * half-open windows and the tag `$unwind` are the behaviour under test.
 */
import repositoryFactory from "../../app/factories/RepositoryFactory";
import { SpendingQuery } from "../../domain/repositories/transaction/ITransactionRepository";
import {
  connect,
  disconnect,
  dropDatabase,
  Fixture,
  fixtureDir,
  loadFixtures,
  seedFixture,
  services,
} from "./support";

const PAGE = { limit: 100, offset: 0 };

describe("offline parity fixtures", () => {
  let fixtures: Fixture[];

  beforeAll(async () => {
    fixtures = loadFixtures();
    await connect();
    await dropDatabase();
    for (const fixture of fixtures) {
      await seedFixture(fixture);
    }
  });

  afterAll(async () => {
    await dropDatabase();
    await disconnect();
  });

  it(`reads ${"the fixtures"} from the shared directory`, () => {
    expect(fixtureDir()).toContain("offline-fixtures");
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(loadFixtures())("$id", (fixture: Fixture) => {
    const userId = fixture.user.id;

    it("stores the balance each set of movements adds up to", async () => {
      const repo = repositoryFactory.getAccountRepository();
      for (const expected of fixture.expected.balances) {
        const account = await repo.getByIdIncludingArchived(expected.accountId);
        expect([expected.key, account?.balance]).toEqual([
          expected.key,
          expected.balance,
        ]);
      }
    });

    it("counts and totals the same rows awaiting review", async () => {
      const { transactions } = services();
      const page = (await transactions.getAllTransactions(userId, PAGE, {
        pendingDetails: true,
        includeSummary: true,
      })) as Awaited<ReturnType<typeof transactions.getAllTransactions>> & {
        summary?: { totalAmount: number };
      };

      expect(page.pagination.total).toBe(fixture.expected.pending.count);
      expect(page.summary?.totalAmount).toBe(fixture.expected.pending.total);
      expect([...page.data.map((t) => t.id)].sort()).toEqual(
        [...fixture.expected.pending.transactionIds].sort(),
      );
    });

    it.each(fixture.expected.spending.map((s) => [s.name, s] as const))(
      "aggregates %s exactly as the fixture says",
      async (_name, expected) => {
        const { stats } = services();
        const query: SpendingQuery = {
          groupBy: expected.query.groupBy,
          timezone: expected.query.timezone,
          from: new Date(expected.query.from),
          to: new Date(expected.query.to),
          ...(expected.query.type
            ? { type: expected.query.type as SpendingQuery["type"] }
            : {}),
        };

        const result = await stats.getSpending(userId, query);

        expect(result.total).toBe(expected.total);
        expect(result.buckets).toEqual(expected.buckets);
      },
    );

    it("resolves every budget window, amount and spend", async () => {
      const { budgets } = services();
      const ctx = {
        reference: new Date(fixture.expected.budgets.reference),
        timezone: fixture.user.timezone,
      };

      const page = await budgets.getBudgets(
        userId,
        PAGE,
        { includeExpired: true },
        ctx,
      );

      // Archived budgets produce no view: the fixture lists exactly the ones
      // the client should be able to show.
      expect(page.data.map((v) => v.id).sort()).toEqual(
        fixture.expected.budgets.views.map((v) => v.id).sort(),
      );

      for (const expected of fixture.expected.budgets.views) {
        const view = page.data.find((v) => v.id === expected.id);
        expect([expected.key, view && summarise(view)]).toEqual([
          expected.key,
          {
            periodKey: expected.periodKey,
            periodFrom: expected.periodFrom,
            periodTo: expected.periodTo,
            baseAmount: expected.baseAmount,
            amount: expected.amount,
            hasOverride: expected.hasOverride,
            spent: expected.spent,
            expired: expected.expired,
            archivedCategoryIds: expected.archivedCategoryIds,
          },
        ]);
      }
    });
  });
});

function summarise(view: {
  periodKey: string;
  periodFrom: Date;
  periodTo: Date;
  baseAmount: number;
  amount: number;
  hasOverride: boolean;
  spent: number;
  expired: boolean;
  archivedCategoryIds: string[];
}): Record<string, unknown> {
  return {
    periodKey: view.periodKey,
    periodFrom: view.periodFrom.toISOString(),
    periodTo: view.periodTo.toISOString(),
    baseAmount: view.baseAmount,
    amount: view.amount,
    hasOverride: view.hasOverride,
    spent: view.spent,
    expired: view.expired,
    archivedCategoryIds: view.archivedCategoryIds,
  };
}
