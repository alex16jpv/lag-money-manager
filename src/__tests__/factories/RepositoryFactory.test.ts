jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    DB_TYPE: "SEQ",
    LOG_LEVEL: "info",
    NODE_ENV: "test",
  },
  DB_TYPES: { SEQ: "SEQ", MONGO: "MONGO", LOCAL_STORAGE: "LOCAL_STORAGE" },
}));

jest.mock("../../shared/logger", () => ({
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

jest.mock("../../app/factories/providers/sequelizeProvider", () => ({
  dbType: "SEQ",
  registerRepositories: jest.fn(
    (factory: { register: (key: string, creator: () => unknown) => void }) => {
      factory.register("user", () => ({ type: "mock-user-seq-repo" }));
      factory.register("account", () => ({ type: "mock-account-seq-repo" }));
      factory.register("category", () => ({ type: "mock-category-seq-repo" }));
      factory.register("transaction", () => ({
        type: "mock-transaction-seq-repo",
      }));
    },
  ),
}));

jest.mock("../../app/factories/providers/mongoProvider", () => ({
  dbType: "MONGO",
  registerRepositories: jest.fn(
    (factory: { register: (key: string, creator: () => unknown) => void }) => {
      factory.register("user", () => ({ type: "mock-user-mongo-repo" }));
      factory.register("account", () => ({ type: "mock-account-mongo-repo" }));
      factory.register("category", () => ({
        type: "mock-category-mongo-repo",
      }));
      factory.register("transaction", () => ({
        type: "mock-transaction-mongo-repo",
      }));
    },
  ),
}));

import {
  RepositoryFactory,
  REPO_KEYS,
} from "../../app/factories/RepositoryFactory";

describe("RepositoryFactory", () => {
  describe("construction", () => {
    it("should create a factory instance using the SEQ provider", () => {
      const factory = new RepositoryFactory();
      expect(factory).toBeDefined();
    });
  });

  describe("typed getters", () => {
    let factory: RepositoryFactory;

    beforeEach(() => {
      factory = new RepositoryFactory();
    });

    it("should return a user repository", () => {
      const repo = factory.getUserRepository();
      expect(repo).toBeDefined();
    });

    it("should return an account repository", () => {
      const repo = factory.getAccountRepository();
      expect(repo).toBeDefined();
    });

    it("should return a category repository", () => {
      const repo = factory.getCategoryRepository();
      expect(repo).toBeDefined();
    });

    it("should return a transaction repository", () => {
      const repo = factory.getTransactionRepository();
      expect(repo).toBeDefined();
    });
  });

  describe("caching", () => {
    it("should return the same instance on repeated calls", () => {
      const factory = new RepositoryFactory();

      const first = factory.getUserRepository();
      const second = factory.getUserRepository();

      expect(first).toBe(second);
    });
  });

  describe("REPO_KEYS", () => {
    it("should have all expected keys", () => {
      expect(REPO_KEYS.USER).toBe("user");
      expect(REPO_KEYS.ACCOUNT).toBe("account");
      expect(REPO_KEYS.CATEGORY).toBe("category");
      expect(REPO_KEYS.TRANSACTION).toBe("transaction");
    });
  });
});
