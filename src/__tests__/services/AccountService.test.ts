jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: { PORT: 3000, DB_TYPE: "SEQ", JWT_SECRET: "test" },
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
  DB_TYPES: { SEQ: "SEQ", MONGO: "MONGO", LOCAL_STORAGE: "LOCAL_STORAGE" },
  TRANSACTION_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
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
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { Account } from "../../domain/entities/Account";
import { ApiError } from "../../shared/errors";
import { DomainValidationError } from "../../domain/errors";
import { CreateAccountDTO } from "../../app/dtos/AccountDTO";

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
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

describe("AccountService", () => {
  let service: AccountService;
  let repo: jest.Mocked<IAccountRepository>;

  beforeEach(() => {
    repo = createMockRepo();
    service = new AccountService(repo);
  });

  describe("getAllAccounts", () => {
    it("should return all accounts", async () => {
      repo.getAll.mockResolvedValue([mockAccount]);

      const result = await service.getAllAccounts();

      expect(repo.getAll).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Savings");
    });

    it("should return empty array when no accounts exist", async () => {
      repo.getAll.mockResolvedValue([]);

      const result = await service.getAllAccounts();

      expect(result).toEqual([]);
    });
  });

  describe("getAccountById", () => {
    it("should return account when found", async () => {
      repo.getById.mockResolvedValue(mockAccount);

      const result = await service.getAccountById(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );

      expect(repo.getById).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );
      expect(result.name).toBe("Savings");
    });

    it("should throw NotFound when account does not exist", async () => {
      repo.getById.mockResolvedValue(null);

      await expect(
        service.getAccountById("019576a0-d7b6-7d6d-af6a-000000000000"),
      ).rejects.toThrow(ApiError);
      await expect(
        service.getAccountById("019576a0-d7b6-7d6d-af6a-000000000000"),
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

    it("should throw when validation fails (missing name)", async () => {
      const invalid: CreateAccountDTO = {
        ...validAccountProps,
        name: "" as unknown as string,
      };

      await expect(service.createAccount(invalid)).rejects.toThrow(
        DomainValidationError,
      );
      await expect(service.createAccount(invalid)).rejects.toThrow(
        "'name' is required",
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("should throw when validation fails (invalid type)", async () => {
      const invalid = {
        ...validAccountProps,
        type: "INVALID" as unknown as typeof validAccountProps.type,
      };

      await expect(service.createAccount(invalid)).rejects.toThrow(
        DomainValidationError,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe("updateAccount", () => {
    it("should update an account", async () => {
      const updated = new Account({ ...validAccountProps, name: "Updated" });
      repo.update.mockResolvedValue(updated);

      const result = await service.updateAccount(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        { name: "Updated" },
      );

      expect(repo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        { name: "Updated" },
      );
      expect(result.name).toBe("Updated");
    });

    it("should throw when id in body does not match param id", async () => {
      await expect(
        service.updateAccount("019576a0-d7b6-7d6d-af6a-2b7545f5ac70", {
          id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
        }),
      ).rejects.toThrow(ApiError);
      await expect(
        service.updateAccount("019576a0-d7b6-7d6d-af6a-2b7545f5ac70", {
          id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
        }),
      ).rejects.toThrow("Account id does not match");
    });
  });

  describe("deleteAccount", () => {
    it("should delete an account", async () => {
      repo.delete.mockResolvedValue();

      await service.deleteAccount("019576a0-d7b6-7d6d-af6a-2b7545f5ac70");

      expect(repo.delete).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );
    });
  });
});
