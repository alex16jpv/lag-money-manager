jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    PORT: 3000,
    DB_TYPE: "MONGO",
    JWT_SECRET: "test",
    BCRYPT_SALT_ROUNDS: 12,
    JWT_EXPIRATION: "24h",
    LOG_LEVEL: "info",
    NODE_ENV: "test",
  },
  ACCOUNT_TYPES: {
    CASH: "CASH",
    ACCOUNT: "ACCOUNT",
    CARD: "CARD",
    DEBIT_CARD: "DEBIT_CARD",
    SAVINGS: "SAVINGS",
    INVESTMENT: "INVESTMENT",
    OVERDRAFT: "OVERDRAFT",
    LOAN: "LOAN",
    OTHER: "OTHER",
  },
  COLORS: {
    RED: "RED",
    ORANGE: "ORANGE",
    AMBER: "AMBER",
    YELLOW: "YELLOW",
    LIME: "LIME",
    GREEN: "GREEN",
    TEAL: "TEAL",
    CYAN: "CYAN",
    BLUE: "BLUE",
    INDIGO: "INDIGO",
    PURPLE: "PURPLE",
    PINK: "PINK",
    ROSE: "ROSE",
    GRAY: "GRAY",
    BROWN: "BROWN",
    BLACK: "BLACK",
  },
  DEBT_ACCOUNT_FIELDS: {
    creditLimit: ["CARD", "OVERDRAFT"],
    borrowedAmount: ["LOAN"],
  },
  DEBT_ACCOUNT_FIELD_NAMES: ["creditLimit", "borrowedAmount"],
  DB_TYPES: { MONGO: "MONGO" },
  TRANSACTION_SOURCES: { MANUAL: "MANUAL", QUICK: "QUICK", IMPORT: "IMPORT" },
  TRANSACTION_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
  },
  CATEGORY_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
  },
  MODEL_NAMES: {
    USER: "User",
    ACCOUNT: "Account",
    TRANSACTION: "Transaction",
    BUDGET: "Budget",
    CATEGORY: "Category",
  },
}));

import { AccountService } from "../../app/services/AccountService";
import { Account } from "../../domain/entities/Account";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { User } from "../../domain/entities/User";
import { ApiError } from "../../shared/errors";

const validAccountProps = {
  id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
  name: "Savings",
  type: "SAVINGS" as const,
  balance: 500,
  userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
};

const mockAccount = new Account(validAccountProps);

const createMockRepo = (): jest.Mocked<IAccountRepository> => ({
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getByIdIncludingArchived: jest.fn(),
  findActiveByName: jest.fn().mockResolvedValue(null),
  getOwnById: jest.fn(),
  changesSince: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  incrementBalance: jest.fn().mockResolvedValue(true),
  archiveNonDefault: jest.fn().mockResolvedValue(null),
  restore: jest.fn(),
  getDefaultByUserId: jest.fn(),
  setDefault: jest.fn(),
  countByUserId: jest.fn().mockResolvedValue(1),
});

const createUserRepoMock = () =>
  ({
    getById: jest.fn().mockResolvedValue(
      new User({
        id: validAccountProps.userId,
        name: "Owner",
        email: "owner@test.com",
        currency: "COP",
      }),
    ),
  }) as unknown as jest.Mocked<IUserRepository>;

describe("AccountService", () => {
  let service: AccountService;
  let repo: jest.Mocked<IAccountRepository>;
  let userRepo: jest.Mocked<IUserRepository>;

  beforeEach(() => {
    repo = createMockRepo();
    userRepo = createUserRepoMock();
    service = new AccountService(repo, userRepo);
  });

  describe("getAllAccounts", () => {
    const pagination = { limit: 20, offset: 0 };

    it("should return all accounts for the user", async () => {
      repo.getAllByUserId.mockResolvedValue({
        data: [mockAccount],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      });

      const result = await service.getAllAccounts(
        validAccountProps.userId,
        pagination,
      );

      expect(repo.getAllByUserId).toHaveBeenCalledWith(
        validAccountProps.userId,
        pagination,
        undefined,
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe("Savings");
    });

    it("should return empty array when no accounts exist", async () => {
      repo.getAllByUserId.mockResolvedValue({
        data: [],
        pagination: {
          limit: 20,
          offset: 0,
          total: 0,
          hasMore: false,
          nextCursor: null,
        },
      });

      const result = await service.getAllAccounts(
        validAccountProps.userId,
        pagination,
      );

      expect(result.data).toEqual([]);
    });

    it("should pass ids filter to repository", async () => {
      repo.getAllByUserId.mockResolvedValue({
        data: [mockAccount],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      });

      const filters = { ids: ["019576a0-d7b6-7d6d-af6a-2b7545f5ac70"] };
      await service.getAllAccounts(
        validAccountProps.userId,
        pagination,
        filters,
      );

      expect(repo.getAllByUserId).toHaveBeenCalledWith(
        validAccountProps.userId,
        pagination,
        filters,
      );
    });
  });

  describe("getAccountById", () => {
    it("should return account when found and owned by user", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(mockAccount);

      const result = await service.getAccountById(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        validAccountProps.userId,
      );

      expect(repo.getByIdIncludingArchived).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );
      expect(result.name).toBe("Savings");
    });

    it("should throw NotFound when account does not exist", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(null);

      await expect(
        service.getAccountById(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          validAccountProps.userId,
        ),
      ).rejects.toThrow(ApiError);
      await expect(
        service.getAccountById(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          validAccountProps.userId,
        ),
      ).rejects.toThrow("Account not found");
    });
  });

  describe("createAccount", () => {
    it("should create and return an account", async () => {
      repo.create.mockResolvedValue(mockAccount);

      const result = await service.createAccount(validAccountProps);

      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(result.name).toBe("Savings");
    });

    it("stamps the owner's currency on the account [multi-moneda etapa 1]", async () => {
      repo.create.mockImplementation(async (a) => new Account(a as never));

      const result = await service.createAccount(validAccountProps);

      expect(result.currency).toBe("COP");
    });

    it("marks the first account as default [F2]", async () => {
      repo.countByUserId.mockResolvedValue(0);
      repo.create.mockImplementation(async (a) => new Account(a as never));

      const result = await service.createAccount(validAccountProps);

      expect(result.isDefault).toBe(true);
    });

    // O-B1: `balance` moves with every transaction, so a replay is judged against the opening one.
    it("replays a client-minted id against openingBalance, not the live balance [O-B1]", async () => {
      const outcome = { replayed: false };
      repo.getOwnById.mockResolvedValue(
        new Account({
          ...validAccountProps,
          balance: 12345,
          openingBalance: 500,
        }),
      );

      const result = await service.createAccount(validAccountProps, outcome);

      expect(outcome.replayed).toBe(true);
      expect(result.balance).toBe(12345);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("replays a client-minted id even when the stored account differs [O-B1]", async () => {
      const outcome = { replayed: false };
      repo.getOwnById.mockResolvedValue(
        new Account({ ...validAccountProps, type: "CASH" }),
      );

      const result = await service.createAccount(validAccountProps, outcome);

      expect(outcome.replayed).toBe(true);
      expect(result.type).toBe("CASH");
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("never reads an id it does not own [O-B1]", async () => {
      repo.getOwnById.mockResolvedValue(null);
      repo.create.mockRejectedValue(
        Object.assign(new Error("E11000"), {
          code: 11000,
          keyPattern: { _id: 1 },
        }),
      );

      await expect(service.createAccount(validAccountProps)).rejects.toThrow(
        expect.objectContaining({ code: "ID_TAKEN" }),
      );
      expect(repo.getById).not.toHaveBeenCalled();
      expect(repo.getByIdIncludingArchived).not.toHaveBeenCalled();
    });
  });

  describe("setDefaultAccount [F2]", () => {
    it("sets the account as default", async () => {
      repo.setDefault.mockResolvedValue(
        new Account({ ...validAccountProps, isDefault: true }),
      );

      const result = await service.setDefaultAccount(
        mockAccount.id,
        mockAccount.userId,
      );

      expect(repo.setDefault).toHaveBeenCalledWith(
        mockAccount.id,
        mockAccount.userId,
        undefined,
      );
      expect(result.isDefault).toBe(true);
    });

    it("throws NotFound when the account does not exist", async () => {
      repo.setDefault.mockResolvedValue(null);

      await expect(
        service.setDefaultAccount(mockAccount.id, mockAccount.userId),
      ).rejects.toThrow("Account not found");
    });
  });

  describe("updateAccount", () => {
    it("should update an account", async () => {
      const updated = new Account({ ...validAccountProps, name: "Updated" });
      repo.getByIdIncludingArchived.mockResolvedValue(mockAccount);
      repo.update.mockResolvedValue(updated);

      const result = await service.updateAccount(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        { name: "Updated" },
        validAccountProps.userId,
      );

      expect(repo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        { name: "Updated" },
        undefined,
        undefined,
      );
      expect(result.name).toBe("Updated");
    });

    it("should throw when id in body does not match param id", async () => {
      await expect(
        service.updateAccount(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          {
            id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
          },
          validAccountProps.userId,
        ),
      ).rejects.toThrow(ApiError);
      await expect(
        service.updateAccount(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          {
            id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
          },
          validAccountProps.userId,
        ),
      ).rejects.toThrow("Account id does not match");
    });
  });

  describe("debt fields [T-87]", () => {
    const cardProps = {
      ...validAccountProps,
      id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
      name: "Visa Gold",
      type: "CARD" as const,
    };

    it("stores a credit limit on a CARD", async () => {
      repo.create.mockImplementation(async (a) => new Account(a as never));

      const result = await service.createAccount({
        ...cardProps,
        creditLimit: 4_000_000,
      });

      expect(result.creditLimit).toBe(4_000_000);
    });

    it("stores a credit limit on an OVERDRAFT", async () => {
      repo.create.mockImplementation(async (a) => new Account(a as never));

      const result = await service.createAccount({
        ...cardProps,
        type: "OVERDRAFT",
        creditLimit: 1_000_000,
      });

      expect(result.creditLimit).toBe(1_000_000);
    });

    it("stores the amount borrowed on a LOAN", async () => {
      repo.create.mockImplementation(async (a) => new Account(a as never));

      const result = await service.createAccount({
        ...cardProps,
        type: "LOAN",
        borrowedAmount: 12_000_000,
      });

      expect(result.borrowedAmount).toBe(12_000_000);
    });

    it("leaves an account that sets neither without them", async () => {
      repo.create.mockImplementation(async (a) => new Account(a as never));

      const result = await service.createAccount(validAccountProps);

      expect(result.creditLimit).toBeUndefined();
      expect(result.borrowedAmount).toBeUndefined();
    });

    it("refuses a credit limit on a type that has none", async () => {
      await expect(
        service.createAccount({ ...validAccountProps, creditLimit: 100 }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "ACCOUNT_FIELD_NOT_FOR_TYPE",
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("refuses the amount borrowed on a CARD", async () => {
      await expect(
        service.createAccount({ ...cardProps, borrowedAmount: 100 }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "ACCOUNT_FIELD_NOT_FOR_TYPE",
      });
    });

    it("refuses a credit limit with more decimals than the owner's currency has", async () => {
      userRepo.getById.mockResolvedValue(
        new User({
          id: validAccountProps.userId,
          name: "Owner",
          email: "owner@test.com",
          currency: "JPY",
        }),
      );

      await expect(
        service.createAccount({ ...cardProps, creditLimit: 100.5 }),
      ).rejects.toMatchObject({ code: "AMOUNT_PRECISION" });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("sets a credit limit on a card that had none", async () => {
      const card = new Account(cardProps);
      repo.getByIdIncludingArchived.mockResolvedValue(card);
      repo.update.mockImplementation(
        async (_id, a) => new Account({ ...cardProps, ...a } as never),
      );

      const result = await service.updateAccount(
        cardProps.id,
        { creditLimit: 4_000_000 },
        cardProps.userId,
      );

      expect(result.creditLimit).toBe(4_000_000);
    });

    it("clears a credit limit with null", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(
        new Account({ ...cardProps, creditLimit: 4_000_000 }),
      );
      repo.update.mockImplementation(
        async (_id, a) => new Account({ ...cardProps, ...a } as never),
      );

      const result = await service.updateAccount(
        cardProps.id,
        { creditLimit: null },
        cardProps.userId,
      );

      expect(repo.update).toHaveBeenCalledWith(
        cardProps.id,
        { creditLimit: null },
        undefined,
        undefined,
      );
      expect(result.creditLimit).toBeUndefined();
    });

    it("refuses a type change that would orphan the stored limit", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(
        new Account({ ...cardProps, creditLimit: 4_000_000 }),
      );

      await expect(
        service.updateAccount(cardProps.id, { type: "CASH" }, cardProps.userId),
      ).rejects.toMatchObject({ code: "ACCOUNT_FIELD_NOT_FOR_TYPE" });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("allows the same type change when the write clears the limit", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(
        new Account({ ...cardProps, creditLimit: 4_000_000 }),
      );
      repo.update.mockImplementation(
        async (_id, a) => new Account({ ...cardProps, ...a } as never),
      );

      const result = await service.updateAccount(
        cardProps.id,
        { type: "CASH", creditLimit: null },
        cardProps.userId,
      );

      expect(result.type).toBe("CASH");
      expect(result.creditLimit).toBeUndefined();
    });

    it("refuses a limit on the wrong type even when the type is not changing", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(new Account(cardProps));

      await expect(
        service.updateAccount(
          cardProps.id,
          { borrowedAmount: 100 },
          cardProps.userId,
        ),
      ).rejects.toMatchObject({ code: "ACCOUNT_FIELD_NOT_FOR_TYPE" });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("does not refuse a rename over a pairing the write did not create", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(
        new Account({ ...cardProps, type: "CASH", creditLimit: 4_000_000 }),
      );
      repo.update.mockImplementation(
        async (_id, a) => new Account({ ...cardProps, ...a } as never),
      );

      const result = await service.updateAccount(
        cardProps.id,
        { name: "Wallet" },
        cardProps.userId,
      );

      expect(result.name).toBe("Wallet");
    });

    it("carries the version it read into a write that leans on it", async () => {
      const version = new Date("2026-09-17T10:00:00.000Z");
      repo.getByIdIncludingArchived.mockResolvedValue(
        new Account({ ...cardProps, updatedAt: version }),
      );
      repo.update.mockImplementation(
        async (_id, a) => new Account({ ...cardProps, ...a } as never),
      );

      await service.updateAccount(
        cardProps.id,
        { creditLimit: 4_000_000 },
        cardProps.userId,
      );

      expect(repo.update).toHaveBeenCalledWith(
        cardProps.id,
        { creditLimit: 4_000_000 },
        undefined,
        version,
      );
    });

    it("leaves a write that touches neither unconditional", async () => {
      const version = new Date("2026-09-17T10:00:00.000Z");
      repo.getByIdIncludingArchived.mockResolvedValue(
        new Account({ ...cardProps, updatedAt: version }),
      );
      repo.update.mockImplementation(
        async (_id, a) => new Account({ ...cardProps, ...a } as never),
      );

      await service.updateAccount(
        cardProps.id,
        { name: "Visa Platinum" },
        cardProps.userId,
      );

      expect(repo.update).toHaveBeenCalledWith(
        cardProps.id,
        { name: "Visa Platinum" },
        undefined,
        undefined,
      );
    });

    it("leaves a stored limit alone when the write does not mention it", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(
        new Account({ ...cardProps, creditLimit: 4_000_000 }),
      );
      repo.update.mockImplementation(
        async (_id, a) =>
          new Account({ ...cardProps, creditLimit: 4_000_000, ...a } as never),
      );

      const result = await service.updateAccount(
        cardProps.id,
        { name: "Visa Platinum" },
        cardProps.userId,
      );

      expect(result.creditLimit).toBe(4_000_000);
    });
  });

  describe("deleteAccount (archive)", () => {
    it("rejects archiving the default account [R2-03]", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(
        new Account({ ...validAccountProps, isDefault: true }),
      );

      await expect(
        service.deleteAccount(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          validAccountProps.userId,
        ),
      ).rejects.toThrow("Cannot archive the default account");
      expect(repo.archiveNonDefault).not.toHaveBeenCalled();
    });

    it("should archive an account (even when it has transactions)", async () => {
      const archivedAt = new Date("2026-09-05T10:00:00.000Z");
      repo.getByIdIncludingArchived.mockResolvedValue(mockAccount);
      repo.archiveNonDefault.mockResolvedValue(
        new Account({
          ...validAccountProps,
          archivedAt,
          updatedAt: archivedAt,
        }),
      );

      const archived = await service.deleteAccount(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        validAccountProps.userId,
      );

      expect(repo.archiveNonDefault).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        validAccountProps.userId,
        undefined,
      );
      // F-22: the archived row comes back so the client learns its new updatedAt.
      expect(archived).toBeInstanceOf(Account);
      expect(archived.archivedAt).toEqual(archivedAt);
      expect(archived.updatedAt).toEqual(archivedAt);
    });

    it("answers the row unchanged when it was already archived (idempotent)", async () => {
      const archivedAt = new Date("2026-09-01T00:00:00.000Z");
      repo.getByIdIncludingArchived.mockResolvedValue(
        new Account({ ...validAccountProps, archivedAt }),
      );

      const archived = await service.deleteAccount(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        validAccountProps.userId,
      );

      expect(archived.archivedAt).toEqual(archivedAt);
      expect(repo.archiveNonDefault).not.toHaveBeenCalled();
    });

    it("rejects when the account became default between check and archive (race)", async () => {
      repo.getByIdIncludingArchived
        .mockResolvedValueOnce(mockAccount)
        .mockResolvedValueOnce(
          new Account({ ...validAccountProps, isDefault: true }),
        );
      repo.archiveNonDefault.mockResolvedValue(null);

      await expect(
        service.deleteAccount(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          validAccountProps.userId,
        ),
      ).rejects.toThrow("Cannot archive the default account");
    });

    it("resolves when a concurrent archive wins the race (idempotent)", async () => {
      repo.getByIdIncludingArchived
        .mockResolvedValueOnce(mockAccount)
        .mockResolvedValueOnce(
          new Account({ ...validAccountProps, archivedAt: new Date() }),
        );
      repo.archiveNonDefault.mockResolvedValue(null);

      await expect(
        service.deleteAccount(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          validAccountProps.userId,
        ),
      ).resolves.toMatchObject({ archivedAt: expect.any(Date) });
    });

    it("should throw NotFound when archiving non-existent account", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(null);

      await expect(
        service.deleteAccount(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          validAccountProps.userId,
        ),
      ).rejects.toThrow("Account not found");
    });

    it("should throw Forbidden when archiving another user's account", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(mockAccount);

      await expect(
        service.deleteAccount(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          "another-user",
        ),
      ).rejects.toThrow("Account not found");

      expect(repo.archiveNonDefault).not.toHaveBeenCalled();
    });
  });

  describe("restoreAccount", () => {
    // Otherwise the user is stuck: restore 409s on the name and renaming the archived one is refused.
    it("renames as part of the same write when a new name is given", async () => {
      repo.restore.mockResolvedValue(
        new Account({ ...validAccountProps, name: "Nequi antiguo" }),
      );

      const result = await service.restoreAccount(
        mockAccount.id,
        mockAccount.userId,
        "Nequi antiguo",
      );

      expect(repo.restore).toHaveBeenCalledWith(
        mockAccount.id,
        mockAccount.userId,
        "Nequi antiguo",
        undefined,
      );
      expect(result.name).toBe("Nequi antiguo");
    });

    it("restores the user's archived account", async () => {
      repo.restore.mockResolvedValue(mockAccount);

      const result = await service.restoreAccount(
        mockAccount.id,
        mockAccount.userId,
      );

      expect(repo.restore).toHaveBeenCalledWith(
        mockAccount.id,
        mockAccount.userId,
        undefined,
        undefined,
      );
      expect(result.id).toBe(mockAccount.id);
    });

    it("throws NotFound when there is nothing to restore", async () => {
      repo.restore.mockResolvedValue(null);

      await expect(
        service.restoreAccount(mockAccount.id, mockAccount.userId),
      ).rejects.toThrow("Account not found");
    });
  });

  describe("error propagation", () => {
    it("should propagate repository error on getAll failure", async () => {
      repo.getAllByUserId.mockRejectedValue(new Error("DB connection lost"));

      await expect(
        service.getAllAccounts(validAccountProps.userId, {
          limit: 20,
          offset: 0,
        }),
      ).rejects.toThrow("DB connection lost");
    });

    it("should propagate repository error on create failure", async () => {
      repo.create.mockRejectedValue(new Error("DB write failed"));

      await expect(service.createAccount(validAccountProps)).rejects.toThrow(
        "DB write failed",
      );
    });

    it("should throw NotFound on update when account does not exist", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(null);

      await expect(
        service.updateAccount(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          { name: "Updated" },
          validAccountProps.userId,
        ),
      ).rejects.toThrow("Account not found");
    });
  });
});
