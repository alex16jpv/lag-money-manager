// Real services are imported (their constructors read the environment);
// nothing here touches the database.
process.env.JWT_SECRET ??= "sync-batch-test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.MONGO_URI ??= "mongodb://localhost:27017/unused";

import { AccountService } from "../../app/services/AccountService";
import { BudgetService } from "../../app/services/BudgetService";
import { CategoryService } from "../../app/services/CategoryService";
import { SyncBatchService } from "../../app/services/SyncBatchService";
import { TransactionService } from "../../app/services/TransactionService";
import { SyncOperationInput } from "../../app/validation/schemas";
import { Account } from "../../domain/entities/Account";
import { DomainValidationError } from "../../domain/errors";
import { ISyncOpRepository } from "../../domain/repositories/syncOp/ISyncOpRepository";
import { ApiError, StaleUpdateError } from "../../shared/errors";

const USER = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const TZ = "America/Bogota";
const uuid = (n: number): string =>
  `01940000-0000-7000-8000-${String(n).padStart(12, "0")}`;

type Mocked<T> = { [K in keyof T]: jest.Mock };
const mockService = <T>(...methods: (keyof T)[]): Mocked<T> =>
  Object.fromEntries(methods.map((m) => [m, jest.fn()])) as Mocked<T>;

const accounts = mockService<AccountService>(
  "createAccount",
  "updateAccount",
  "deleteAccount",
  "restoreAccount",
  "setDefaultAccount",
);
const categories = mockService<CategoryService>(
  "createCategory",
  "updateCategory",
  "deleteCategory",
  "restoreCategory",
);
const transactions = mockService<TransactionService>(
  "createTransaction",
  "quickAddTransaction",
  "updateTransaction",
  "deleteTransaction",
);
const budgets = mockService<BudgetService>(
  "createBudget",
  "updateBudget",
  "deleteBudget",
  "restoreBudget",
  "setAmountOverride",
  "clearAmountOverride",
);
const syncOps: jest.Mocked<ISyncOpRepository> = {
  find: jest.fn(),
  record: jest.fn(),
};

const service = new SyncBatchService(
  accounts as unknown as AccountService,
  categories as unknown as CategoryService,
  transactions as unknown as TransactionService,
  budgets as unknown as BudgetService,
  syncOps,
);

const ctx = { userId: USER, timezone: TZ };

let seq = 0;
const op = (
  over: Partial<SyncOperationInput> &
    Pick<SyncOperationInput, "entity" | "action" | "id">,
): SyncOperationInput => ({
  opId: uuid(100 + seq),
  seq: seq++,
  occurredAt: "2026-09-05T10:00:00.000Z",
  payload: {},
  dependsOn: [],
  opVersion: 1,
  ...over,
});

const account = (id: string, name = "Wallet"): Account =>
  new Account({
    id,
    name,
    type: "CASH",
    balance: 10,
    userId: USER,
    updatedAt: new Date("2026-09-05T09:00:00.000Z"),
  });

const accountBody = { name: "Wallet", type: "CASH", balance: 10 };

beforeEach(() => {
  jest.clearAllMocks();
  seq = 0;
  syncOps.find.mockResolvedValue(null);
  syncOps.record.mockResolvedValue(undefined);
});

describe("SyncBatchService", () => {
  describe("applying through the existing services", () => {
    it("creates with the envelope id merged into the body and records the op", async () => {
      const id = uuid(1);
      accounts.createAccount.mockResolvedValue(account(id));

      const { results } = await service.apply(ctx, [
        op({
          entity: "account",
          action: "create",
          id,
          payload: { body: accountBody },
        }),
      ]);

      expect(accounts.createAccount).toHaveBeenCalledWith(
        { ...accountBody, id, userId: USER },
        { replayed: false },
      );
      expect(results[0]).toMatchObject({
        status: "applied",
        id,
        result: { id },
      });
      expect(syncOps.record).toHaveBeenCalledWith(USER, results[0].opId, {
        status: "applied",
        entityId: id,
        code: null,
      });
    });

    it("answers `duplicate` when the service replayed a client-minted id", async () => {
      const id = uuid(2);
      accounts.createAccount.mockImplementation(async (_dto, outcome) => {
        outcome.replayed = true;
        return account(id);
      });

      const { results } = await service.apply(ctx, [
        op({
          entity: "account",
          action: "create",
          id,
          payload: { body: accountBody },
        }),
      ]);

      expect(results[0]).toMatchObject({ status: "duplicate", result: { id } });
      expect(syncOps.record).toHaveBeenCalledWith(USER, results[0].opId, {
        status: "duplicate",
        entityId: id,
        code: null,
      });
    });

    it("passes baseUpdatedAt as the If-Match guard of an update", async () => {
      const id = uuid(3);
      accounts.updateAccount.mockResolvedValue(account(id, "Renamed"));

      await service.apply(ctx, [
        op({
          entity: "account",
          action: "update",
          id,
          payload: { body: { name: "Renamed" } },
          baseUpdatedAt: "2026-09-05T09:00:00.000Z",
        }),
      ]);

      expect(accounts.updateAccount).toHaveBeenCalledWith(
        id,
        { name: "Renamed" },
        USER,
        new Date("2026-09-05T09:00:00.000Z"),
      );
    });

    it("ignores a body on an action that takes none", async () => {
      const id = uuid(4);
      accounts.deleteAccount.mockResolvedValue(account(id));

      const { results } = await service.apply(ctx, [
        op({
          entity: "account",
          action: "archive",
          id,
          payload: { body: { anything: "goes" } },
        }),
      ]);

      expect(accounts.deleteAccount).toHaveBeenCalledWith(id, USER, undefined);
      expect(results[0].status).toBe("applied");
    });

    it("answers `applied` without a result when the route answers no row", async () => {
      const id = uuid(5);
      transactions.deleteTransaction.mockResolvedValue(undefined);

      const { results } = await service.apply(ctx, [
        op({ entity: "transaction", action: "delete", id }),
      ]);

      expect(results[0]).toEqual({
        opId: results[0].opId,
        seq: 0,
        entity: "transaction",
        id,
        status: "applied",
      });
    });

    it("resolves the budget period from payload.query.reference and the user's timezone", async () => {
      const id = uuid(6);
      budgets.setAmountOverride.mockResolvedValue({ id });

      await service.apply(ctx, [
        op({
          entity: "budget",
          action: "setOverride",
          id,
          payload: {
            body: { amount: 50 },
            query: { reference: "2026-12-15T12:00:00.000Z" },
          },
          baseUpdatedAt: "2026-09-05T09:00:00.000Z",
        }),
      ]);

      expect(budgets.setAmountOverride).toHaveBeenCalledWith(
        id,
        USER,
        50,
        { reference: new Date("2026-12-15T12:00:00.000Z"), timezone: TZ },
        new Date("2026-09-05T09:00:00.000Z"),
      );
    });

    it("sends the create's Idempotency-Key slot empty: the id already replays", async () => {
      const id = uuid(7);
      transactions.createTransaction.mockResolvedValue({ id });
      const body = {
        type: "EXPENSE",
        amount: 5,
        date: "2026-09-01T12:00:00.000Z",
        fromAccountId: uuid(1),
      };

      await service.apply(ctx, [
        op({ entity: "transaction", action: "create", id, payload: { body } }),
      ]);

      expect(transactions.createTransaction).toHaveBeenCalledWith(
        { ...body, id, userId: USER },
        undefined,
        { replayed: false },
      );
    });
  });

  describe("order and idempotency", () => {
    it("applies in seq order, whatever order the array arrived in", async () => {
      accounts.deleteAccount.mockResolvedValue(account(uuid(1)));
      const late = op({
        entity: "account",
        action: "archive",
        id: uuid(8),
        seq: 5,
      });
      const early = op({
        entity: "account",
        action: "archive",
        id: uuid(9),
        seq: 2,
      });

      const { results } = await service.apply(ctx, [late, early]);

      expect(results.map((r) => r.opId)).toEqual([early.opId, late.opId]);
      expect(accounts.deleteAccount.mock.calls.map((c) => c[0])).toEqual([
        uuid(9),
        uuid(8),
      ]);
    });

    it("answers a remembered opId with `duplicate` and touches nothing", async () => {
      const id = uuid(10);
      syncOps.find.mockResolvedValue({
        status: "applied",
        entityId: id,
        code: null,
      });

      const { results } = await service.apply(ctx, [
        op({
          entity: "account",
          action: "create",
          id,
          payload: { body: accountBody },
        }),
      ]);

      expect(results[0]).toMatchObject({ status: "duplicate", id });
      expect(results[0].result).toBeUndefined();
      expect(accounts.createAccount).not.toHaveBeenCalled();
      expect(syncOps.record).not.toHaveBeenCalled();
    });

    it("does not remember a conflict or a rejection: the device may resend them fixed", async () => {
      accounts.updateAccount
        .mockRejectedValueOnce(
          new StaleUpdateError(account(uuid(11), "Server")),
        )
        .mockRejectedValueOnce(new ApiError("NotFound", "Account not found"));

      const { results } = await service.apply(ctx, [
        op({
          entity: "account",
          action: "update",
          id: uuid(11),
          payload: { body: { name: "A" } },
        }),
        op({
          entity: "account",
          action: "update",
          id: uuid(12),
          payload: { body: { name: "B" } },
        }),
      ]);

      expect(results.map((r) => r.status)).toEqual(["conflict", "rejected"]);
      expect(syncOps.record).not.toHaveBeenCalled();
    });
  });

  describe("conflicts and rejections carry the route's answer", () => {
    it("STALE_UPDATE becomes `conflict` with the server's row in `current`", async () => {
      const id = uuid(13);
      accounts.updateAccount.mockRejectedValue(
        new StaleUpdateError(account(id, "Renamed elsewhere")),
      );

      const { results } = await service.apply(ctx, [
        op({
          entity: "account",
          action: "update",
          id,
          payload: { body: { name: "Renamed here" } },
          baseUpdatedAt: "2026-09-05T08:00:00.000Z",
        }),
      ]);

      expect(results[0]).toMatchObject({
        status: "conflict",
        code: "STALE_UPDATE",
        current: { id, name: "Renamed elsewhere" },
      });
    });

    it("a Mongo duplicate key becomes `conflict` DUPLICATE, as the route's 409", async () => {
      const mongoError = Object.assign(new Error("E11000"), {
        name: "MongoServerError",
        code: 11000,
        keyValue: { userId: USER, name: "Wallet" },
      });
      accounts.createAccount.mockRejectedValue(mongoError);

      const { results } = await service.apply(ctx, [
        op({
          entity: "account",
          action: "create",
          id: uuid(14),
          payload: { body: accountBody },
        }),
      ]);

      expect(results[0]).toMatchObject({
        status: "conflict",
        code: "DUPLICATE",
        message: "Duplicate value for: userId, name",
      });
    });

    it("a 404 becomes `rejected` NOT_FOUND, like the transaction batch does", async () => {
      accounts.updateAccount.mockRejectedValue(
        new ApiError("NotFound", "Account not found"),
      );

      const { results } = await service.apply(ctx, [
        op({
          entity: "account",
          action: "update",
          id: uuid(15),
          payload: { body: { name: "X" } },
        }),
      ]);

      expect(results[0]).toMatchObject({
        status: "rejected",
        code: "NOT_FOUND",
        message: "Account not found",
      });
      expect(results[0].current).toBeUndefined();
    });

    it("a domain validation error keeps its own code", async () => {
      transactions.createTransaction.mockRejectedValue(
        new DomainValidationError(
          "Date is too far in the future",
          "date",
          "FUTURE_DATE",
        ),
      );

      const { results } = await service.apply(ctx, [
        op({
          entity: "transaction",
          action: "create",
          id: uuid(16),
          payload: {
            body: {
              type: "EXPENSE",
              amount: 5,
              date: "2099-01-01T00:00:00.000Z",
              fromAccountId: uuid(1),
            },
          },
        }),
      ]);

      expect(results[0]).toMatchObject({
        status: "rejected",
        code: "FUTURE_DATE",
        details: [{ field: "date", message: "Date is too far in the future" }],
      });
    });

    it("validates payload.body with the route's schema and rejects only that operation", async () => {
      accounts.createAccount.mockResolvedValue(account(uuid(18)));

      const { results } = await service.apply(ctx, [
        op({
          entity: "account",
          action: "create",
          id: uuid(17),
          payload: { body: { name: "", type: "NOPE", balance: 10.555 } },
        }),
        op({
          entity: "account",
          action: "create",
          id: uuid(18),
          payload: { body: accountBody },
        }),
      ]);

      expect(results[0]).toMatchObject({
        status: "rejected",
        code: "VALIDATION",
      });
      expect(
        (results[0].details as { field: string }[]).map((d) => d.field).sort(),
      ).toEqual(["balance", "name", "type"]);
      expect(results[1].status).toBe("applied");
      expect(accounts.createAccount).toHaveBeenCalledTimes(1);
    });

    it("rejects a create whose body carries a different id than the envelope", async () => {
      const { results } = await service.apply(ctx, [
        op({
          entity: "account",
          action: "create",
          id: uuid(19),
          payload: { body: { ...accountBody, id: uuid(20) } },
        }),
      ]);

      expect(results[0]).toMatchObject({
        status: "rejected",
        code: "VALIDATION",
        details: [
          {
            field: "payload.body.id",
            message: expect.stringContaining("must equal"),
          },
        ],
      });
      expect(accounts.createAccount).not.toHaveBeenCalled();
    });

    it("rejects an action the entity does not have", async () => {
      const { results } = await service.apply(ctx, [
        op({ entity: "category", action: "setDefault", id: uuid(21) }),
      ]);

      expect(results[0]).toMatchObject({
        status: "rejected",
        code: "VALIDATION",
        details: [
          {
            field: "action",
            message: expect.stringContaining(
              "create, update, archive, restore",
            ),
          },
        ],
      });
    });

    it("rejects an opVersion this server does not speak", async () => {
      const { results } = await service.apply(ctx, [
        op({
          entity: "account",
          action: "archive",
          id: uuid(22),
          opVersion: 7,
        }),
      ]);

      expect(results[0]).toMatchObject({
        status: "rejected",
        code: "VALIDATION",
        details: [
          { field: "opVersion", message: expect.stringContaining("7") },
        ],
      });
      expect(accounts.deleteAccount).not.toHaveBeenCalled();
    });

    it("lets an unexpected error fail the whole request, loudly", async () => {
      accounts.deleteAccount.mockRejectedValue(new Error("connection reset"));

      await expect(
        service.apply(ctx, [
          op({ entity: "account", action: "archive", id: uuid(23) }),
        ]),
      ).rejects.toThrow("connection reset");
    });
  });

  describe("dependencies", () => {
    it("blocks what depends on a failed creation and names the blocker", async () => {
      const accountId = uuid(24);
      const failing = op({
        entity: "account",
        action: "create",
        id: accountId,
        payload: { body: accountBody },
      });
      accounts.createAccount.mockRejectedValue(
        new ApiError(
          "BadRequest",
          "Account limit reached (100)",
          "ACCOUNT_LIMIT_REACHED",
        ),
      );
      categories.createCategory.mockResolvedValue({ id: uuid(26) });

      const { results } = await service.apply(ctx, [
        failing,
        op({
          entity: "transaction",
          action: "create",
          id: uuid(25),
          payload: {
            body: {
              type: "EXPENSE",
              amount: 5,
              date: "2026-09-01T12:00:00.000Z",
              fromAccountId: accountId,
            },
          },
          dependsOn: [accountId],
        }),
        op({
          entity: "category",
          action: "create",
          id: uuid(26),
          payload: { body: { name: "Independent" } },
        }),
      ]);

      expect(results.map((r) => r.status)).toEqual([
        "rejected",
        "blocked",
        "applied",
      ]);
      expect(results[1].blockedBy).toBe(failing.opId);
      expect(transactions.createTransaction).not.toHaveBeenCalled();
      expect(syncOps.record).toHaveBeenCalledTimes(1);
    });

    it("blocks a later write on a row whose earlier write did not land", async () => {
      const id = uuid(27);
      const first = op({
        entity: "account",
        action: "update",
        id,
        payload: { body: { name: "A" } },
        baseUpdatedAt: "2026-09-05T08:00:00.000Z",
      });
      accounts.updateAccount.mockRejectedValue(
        new StaleUpdateError(account(id)),
      );

      const { results } = await service.apply(ctx, [
        first,
        op({
          entity: "account",
          action: "archive",
          id,
          baseUpdatedAt: "2026-09-05T08:00:00.000Z",
        }),
      ]);

      expect(results.map((r) => r.status)).toEqual(["conflict", "blocked"]);
      expect(results[1].blockedBy).toBe(first.opId);
      expect(accounts.deleteAccount).not.toHaveBeenCalled();
    });

    it("a blocked operation blocks what depends on it in turn", async () => {
      const a = uuid(28);
      const b = uuid(29);
      const root = op({
        entity: "account",
        action: "create",
        id: a,
        payload: { body: accountBody },
      });
      accounts.createAccount.mockRejectedValue(
        new ApiError("BadRequest", "no", "ACCOUNT_LIMIT_REACHED"),
      );

      const { results } = await service.apply(ctx, [
        root,
        op({
          entity: "transaction",
          action: "create",
          id: b,
          payload: {
            body: {
              type: "EXPENSE",
              amount: 1,
              date: "2026-09-01T12:00:00.000Z",
              fromAccountId: a,
            },
          },
          dependsOn: [a],
        }),
        op({
          entity: "transaction",
          action: "update",
          id: b,
          payload: { body: { note: "x" } },
        }),
      ]);

      expect(results.map((r) => r.status)).toEqual([
        "rejected",
        "blocked",
        "blocked",
      ]);
      expect(results[2].blockedBy).toBe(results[1].opId);
    });

    it("does not block on a dependency that has no operation in this batch", async () => {
      transactions.createTransaction.mockResolvedValue({ id: uuid(30) });

      const { results } = await service.apply(ctx, [
        op({
          entity: "transaction",
          action: "create",
          id: uuid(30),
          payload: {
            body: {
              type: "EXPENSE",
              amount: 1,
              date: "2026-09-01T12:00:00.000Z",
              fromAccountId: uuid(1),
            },
          },
          dependsOn: [uuid(1)],
        }),
      ]);

      expect(results[0].status).toBe("applied");
    });

    it("a remembered opId is not a failure: what depends on it still runs", async () => {
      const accountId = uuid(31);
      syncOps.find
        .mockResolvedValueOnce({
          status: "applied",
          entityId: accountId,
          code: null,
        })
        .mockResolvedValueOnce(null);
      transactions.createTransaction.mockResolvedValue({ id: uuid(32) });

      const { results } = await service.apply(ctx, [
        op({
          entity: "account",
          action: "create",
          id: accountId,
          payload: { body: accountBody },
        }),
        op({
          entity: "transaction",
          action: "create",
          id: uuid(32),
          payload: {
            body: {
              type: "EXPENSE",
              amount: 1,
              date: "2026-09-01T12:00:00.000Z",
              fromAccountId: accountId,
            },
          },
          dependsOn: [accountId],
        }),
      ]);

      expect(results.map((r) => r.status)).toEqual(["duplicate", "applied"]);
    });
  });
});
