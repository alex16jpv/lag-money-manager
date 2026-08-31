jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    PORT: 3000,
    DB_TYPE: "SEQ",
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
  DB_TYPES: { SEQ: "SEQ", MONGO: "MONGO", LOCAL_STORAGE: "LOCAL_STORAGE" },
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

import { CreateAccountDTO } from "../../app/dtos/AccountDTO";
import { AccountService } from "../../app/services/AccountService";
import { Account } from "../../domain/entities/Account";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
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
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

const createMockTransactionRepo = (): jest.Mocked<ITransactionRepository> => ({
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

describe("AccountService", () => {
  let service: AccountService;
  let repo: jest.Mocked<IAccountRepository>;
  let transactionRepo: jest.Mocked<ITransactionRepository>;

  beforeEach(() => {
    repo = createMockRepo();
    transactionRepo = createMockTransactionRepo();
    service = new AccountService(repo, transactionRepo);
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
      await service.getAllAccounts(validAccountProps.userId, pagination, filters);

      expect(repo.getAllByUserId).toHaveBeenCalledWith(
        validAccountProps.userId,
        pagination,
        filters,
      );
    });
  });

  describe("getAccountById", () => {
    it("should return account when found and owned by user", async () => {
      repo.getById.mockResolvedValue(mockAccount);

      const result = await service.getAccountById(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        validAccountProps.userId,
      );

      expect(repo.getById).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );
      expect(result.name).toBe("Savings");
    });

    it("should throw NotFound when account does not exist", async () => {
      repo.getById.mockResolvedValue(null);

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
  });

  describe("updateAccount", () => {
    it("should update an account", async () => {
      const updated = new Account({ ...validAccountProps, name: "Updated" });
      repo.getById.mockResolvedValue(mockAccount);
      repo.update.mockResolvedValue(updated);

      const result = await service.updateAccount(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        { name: "Updated" },
        validAccountProps.userId,
      );

      expect(repo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        { name: "Updated" },
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

  describe("deleteAccount", () => {
    it("should delete an account", async () => {
      repo.getById.mockResolvedValue(mockAccount);
      repo.delete.mockResolvedValue();
      transactionRepo.getAllByUserId.mockResolvedValue({
        data: [],
        pagination: { limit: 1, offset: 0, total: 0, hasMore: false, nextCursor: null },
      });

      await service.deleteAccount(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        validAccountProps.userId,
      );

      expect(repo.delete).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );
    });

    it("should throw NotFound when deleting non-existent account", async () => {
      repo.getById.mockResolvedValue(null);

      await expect(
        service.deleteAccount(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          validAccountProps.userId,
        ),
      ).rejects.toThrow("Account not found");
    });

    it("should throw BadRequest when account has associated transactions", async () => {
      repo.getById.mockResolvedValue(mockAccount);
      transactionRepo.getAllByUserId.mockResolvedValue({
        data: [{}] as any,
        pagination: { limit: 1, offset: 0, total: 1, hasMore: false, nextCursor: null },
      });

      await expect(
        service.deleteAccount(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          validAccountProps.userId,
        ),
      ).rejects.toThrow("Cannot delete account with associated transactions");

      expect(repo.delete).not.toHaveBeenCalled();
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
      repo.getById.mockResolvedValue(null);

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
