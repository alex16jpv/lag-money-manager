import bcryptjs from "bcryptjs";

import { Account } from "../../domain/entities/Account";
import { Budget } from "../../domain/entities/Budget";
import { Category } from "../../domain/entities/Category";
import { Transaction } from "../../domain/entities/Transaction";
import { User } from "../../domain/entities/User";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ApiError } from "../../shared/errors";

// --- Mock repositories ---
const mockUserRepo: jest.Mocked<IUserRepository> = {
  getAll: jest.fn(),
  getById: jest.fn(),
  getByEmail: jest.fn(),
  getDeletedByEmail: jest.fn().mockResolvedValue(null),
  getByIdWithPassword: jest.fn().mockResolvedValue(null),
  bumpTokenVersion: jest.fn().mockResolvedValue(undefined),
  updateWithTokenBump: jest.fn(),
  recordLogin: jest.fn().mockResolvedValue(undefined),
  reactivate: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const mockAccountRepo: jest.Mocked<IAccountRepository> = {
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getByIdIncludingArchived: jest.fn(),
  getOwnById: jest.fn(),
  changesSince: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  incrementBalance: jest.fn().mockResolvedValue(true),
  archiveNonDefault: jest.fn().mockResolvedValue(true),
  restore: jest.fn(),
  getDefaultByUserId: jest.fn(),
  setDefault: jest.fn(),
  countByUserId: jest.fn().mockResolvedValue(1),
};

const mockCategoryRepo: jest.Mocked<ICategoryRepository> = {
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getByIdIncludingArchived: jest.fn(),
  getOwnById: jest.fn(),
  changesSince: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  createMany: jest.fn(),
  listSeedKeys: jest.fn().mockResolvedValue([]),
  listArchivedIds: jest.fn().mockResolvedValue([]),
  countByUserId: jest.fn().mockResolvedValue(0),
  update: jest.fn(),
  delete: jest.fn(),
  restore: jest.fn(),
};

const mockTransactionRepo: jest.Mocked<ITransactionRepository> = {
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getOwnById: jest.fn(),
  changesSince: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  aggregateSpending: jest.fn(),
  listTags: jest.fn().mockResolvedValue([]),
  countByCategory: jest.fn().mockResolvedValue(0),
  sumAmountsByCategory: jest.fn().mockResolvedValue({}),
  sumAmounts: jest.fn().mockResolvedValue(0),
};

const mockBudgetRepo = {
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getByIdIncludingArchived: jest.fn(),
  getOwnById: jest.fn(),
  changesSince: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  findOverlapping: jest.fn().mockResolvedValue([]),
  setAmountOverride: jest.fn(),
  clearAmountOverride: jest.fn(),
};

const mockIdempotencyRepo = {
  find: jest.fn().mockResolvedValue(null),
  record: jest.fn().mockResolvedValue(undefined),
};

const mockRefreshSessionRepo = {
  create: jest.fn().mockResolvedValue(undefined),
  findById: jest.fn().mockResolvedValue(null),
  rotate: jest.fn().mockResolvedValue(null),
  revokeFamily: jest.fn().mockResolvedValue(undefined),
  revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  listActiveByUser: jest.fn().mockResolvedValue([]),
  revokeFamilyForUser: jest.fn().mockResolvedValue(true),
};

// --- Mock modules before importing app ---
jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    PORT: 3000,
    DB_TYPE: "MONGO",
    JWT_SECRET: "test-secret-for-integration",
    JWT_EXPIRATION: "1h",
    REFRESH_TOKEN_EXPIRATION: "30d",
    BCRYPT_SALT_ROUNDS: 12,
    CORS_ORIGIN: "http://localhost:5173",
    RATE_LIMIT_MAX: 100000,
    AUTH_RATE_LIMIT_MAX: 100000,
    LOG_LEVEL: "info",
    NODE_ENV: "test",
  },
  DB_TYPES: { MONGO: "MONGO" },
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
  TRANSACTION_SOURCES: { MANUAL: "MANUAL", QUICK: "QUICK", IMPORT: "IMPORT" },
  TRANSACTION_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
    ADJUSTMENT: "ADJUSTMENT",
  },
  BUDGET_TYPES: { EXPENSE: "EXPENSE", INCOME: "INCOME" },
  BUDGET_PERIOD_TYPES: {
    WEEKLY: "WEEKLY",
    BIWEEKLY: "BIWEEKLY",
    MONTHLY: "MONTHLY",
    QUARTERLY: "QUARTERLY",
    YEARLY: "YEARLY",
    CUSTOM: "CUSTOM",
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

jest.mock("../../shared/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

jest.mock("../../config/swagger", () => ({
  swaggerSpec: {},
}));

// No real MongoDB in these tests: stub the connection and the transaction
// runner so the service layer runs against the mocked repositories.
jest.mock("../../config/mongoConnection", () => ({
  connectMongo: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../shared/unitOfWork", () => ({
  withTransaction: jest.fn((fn: (session: unknown) => unknown) => fn({})),
}));

jest.mock("../../app/middlewares/authRateLimitMiddleware", () => ({
  authRateLimit:
    () =>
    (_req: unknown, _res: unknown, next: () => void): void =>
      next(),
}));

jest.mock("../../app/factories/RepositoryFactory", () => ({
  __esModule: true,
  default: {
    getUserRepository: () => mockUserRepo,
    getAccountRepository: () => mockAccountRepo,
    getCategoryRepository: () => mockCategoryRepo,
    getTransactionRepository: () => mockTransactionRepo,
    getIdempotencyRepository: () => mockIdempotencyRepo,
    getBudgetRepository: () => mockBudgetRepo,
    getRefreshSessionRepository: () => mockRefreshSessionRepo,
  },
  RepositoryFactory: jest.fn(),
}));

import jwt from "jsonwebtoken";
import request from "supertest";

import app from "../../app";

const generateToken = (
  userId: string = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
  email: string = "test@test.com",
) =>
  jwt.sign({ userId, email }, "test-secret-for-integration", {
    expiresIn: "1h",
  });

// --- Test data ---
const testUser = new User({
  id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
  name: "John Doe",
  email: "john@example.com",
  password: bcryptjs.hashSync("password123", 12),
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

const testAccount = new Account({
  id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
  name: "Savings",
  type: "SAVINGS",
  balance: 1000,
  userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
});

const testCategory = new Category({
  id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac73",
  name: "Food",
  icon: "utensils",
  userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
});

const testTransaction = new Transaction({
  id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac74",
  type: "EXPENSE",
  amount: 50,
  date: new Date("2026-03-28"),
  fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
  userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
  categoryId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac73",
  description: "Groceries",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

describe("Integration Tests", () => {
  let token: string;

  beforeAll(() => {
    token = generateToken();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== Health Check ====================
  describe("GET /", () => {
    it("should return hello world", async () => {
      const res = await request(app).get("/");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hello: "world!" });
    });
  });

  // ==================== Auth Routes ====================
  describe("POST /auth/register", () => {
    it("should register a new user", async () => {
      mockUserRepo.create.mockResolvedValue(testUser);

      const res = await request(app).post("/auth/register").send({
        name: "John Doe",
        email: "john@example.com",
        password: "password123",
      });

      expect(res.status).toBe(201);
      expect(mockUserRepo.create).toHaveBeenCalledTimes(1);
    });

    it("should return 400 for invalid email", async () => {
      const res = await request(app).post("/auth/register").send({
        name: "John",
        email: "not-an-email",
        password: "password123",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("ValidationError");
    });

    it("should return 400 for short password", async () => {
      const res = await request(app).post("/auth/register").send({
        name: "John",
        email: "john@example.com",
        password: "short",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("ValidationError");
    });
  });

  describe("POST /auth/login", () => {
    it("should login and return a token", async () => {
      mockUserRepo.getByEmail.mockResolvedValue(testUser);

      const res = await request(app).post("/auth/login").send({
        email: "john@example.com",
        password: "password123",
      });

      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe("string");
      expect(typeof res.body.refreshToken).toBe("string");
    });

    it("should return 401 for wrong password", async () => {
      mockUserRepo.getByEmail.mockResolvedValue(testUser);

      const res = await request(app).post("/auth/login").send({
        email: "john@example.com",
        password: "wrongpassword",
      });

      expect(res.status).toBe(401);
    });

    it("should return 401 for non-existent email", async () => {
      mockUserRepo.getByEmail.mockResolvedValue(null);

      const res = await request(app).post("/auth/login").send({
        email: "noone@example.com",
        password: "password123",
      });

      expect(res.status).toBe(401);
    });

    it("should return 400 for missing fields", async () => {
      const res = await request(app).post("/auth/login").send({});

      expect(res.status).toBe(400);
    });
  });

  describe("POST /auth/refresh [M3]", () => {
    it("issues a new token pair for a valid refresh token", async () => {
      mockUserRepo.getById.mockResolvedValue(testUser);
      mockRefreshSessionRepo.rotate.mockResolvedValue({
        jti: "jti-1",
        userId: testUser.id,
        familyId: "fam-1",
        expiresAt: new Date(Date.now() + 86_400_000),
        replacedBy: null,
        revokedAt: null,
      });
      const refreshToken = jwt.sign(
        {
          userId: testUser.id,
          tokenVersion: testUser.tokenVersion,
          type: "refresh",
          jti: "jti-1",
        },
        "test-secret-for-integration",
        { expiresIn: "30d" },
      );

      const res = await request(app)
        .post("/auth/refresh")
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe("string");
      expect(typeof res.body.refreshToken).toBe("string");
    });

    it("returns 401 for a revoked (stale tokenVersion) refresh token", async () => {
      mockUserRepo.getById.mockResolvedValue(testUser); // tokenVersion 0
      const refreshToken = jwt.sign(
        {
          userId: testUser.id,
          tokenVersion: 99,
          type: "refresh",
          jti: "jti-1",
        },
        "test-secret-for-integration",
        { expiresIn: "30d" },
      );

      const res = await request(app)
        .post("/auth/refresh")
        .send({ refreshToken });

      expect(res.status).toBe(401);
    });

    it("returns 400 when refreshToken is missing", async () => {
      const res = await request(app).post("/auth/refresh").send({});
      expect(res.status).toBe(400);
    });
  });

  // ==================== Auth Middleware ====================
  describe("Auth Middleware", () => {
    it("should return 401 when no token provided", async () => {
      const res = await request(app).get("/users");

      expect(res.status).toBe(401);
    });

    it("should return 401 for invalid token", async () => {
      const res = await request(app)
        .get("/users")
        .set("Authorization", "Bearer invalid-token");

      expect(res.status).toBe(401);
    });

    it("should return 401 for expired token", async () => {
      const expiredToken = jwt.sign(
        {
          userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          email: "test@test.com",
        },
        "test-secret-for-integration",
        { expiresIn: "0s" },
      );

      const res = await request(app)
        .get("/users")
        .set("Authorization", `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
    });

    it("should return 401 for token signed with wrong secret", async () => {
      const wrongSecretToken = jwt.sign(
        {
          userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          email: "test@test.com",
        },
        "wrong-secret",
        { expiresIn: "1h" },
      );

      const res = await request(app)
        .get("/users")
        .set("Authorization", `Bearer ${wrongSecretToken}`);

      expect(res.status).toBe(401);
    });

    it("should return 401 for malformed authorization header", async () => {
      const res = await request(app)
        .get("/users")
        .set("Authorization", "NotBearer some-token");

      expect(res.status).toBe(401);
    });
  });

  // ==================== User Routes ====================
  describe("GET /users", () => {
    it("should be removed (user enumeration) and return 404", async () => {
      const res = await request(app)
        .get("/users")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  describe("GET /users/:id", () => {
    it("should return own user by id", async () => {
      mockUserRepo.getById.mockResolvedValue(testUser);

      const res = await request(app)
        .get("/users/019576a0-d7b6-7d6d-af6a-2b7545f5ac70")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("John Doe");
      expect(res.body.password).toBeUndefined();
    });

    it("should return 404 for accessing another user (uniform, no id probing) [R2-25a]", async () => {
      const res = await request(app)
        .get("/users/019576a0-d7b6-7d6d-af6a-000000000000")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it("should return 400 for non-numeric id", async () => {
      const res = await request(app)
        .get("/users/abc")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /users/:id", () => {
    it("should update own user", async () => {
      const updatedUser = new User({ ...testUser, name: "Updated" });
      mockUserRepo.update.mockResolvedValue(updatedUser);

      const res = await request(app)
        .put("/users/019576a0-d7b6-7d6d-af6a-2b7545f5ac70")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Updated" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated");
      expect(res.body.password).toBeUndefined();
    });

    it("should return 400 for empty update body", async () => {
      const res = await request(app)
        .put("/users/019576a0-d7b6-7d6d-af6a-2b7545f5ac70")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /users/:id", () => {
    it("should delete own user", async () => {
      mockUserRepo.delete.mockResolvedValue();

      const res = await request(app)
        .delete("/users/019576a0-d7b6-7d6d-af6a-2b7545f5ac70")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(mockUserRepo.delete).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );
    });
  });

  // ==================== Account Routes ====================
  describe("GET /accounts", () => {
    it("should return accounts for the authenticated user", async () => {
      mockAccountRepo.getAllByUserId.mockResolvedValue({
        data: [testAccount],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      });

      const res = await request(app)
        .get("/accounts")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination).toBeDefined();
    });
  });

  describe("POST /accounts", () => {
    it("should create an account", async () => {
      mockAccountRepo.create.mockResolvedValue(testAccount);

      const res = await request(app)
        .post("/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Savings",
          type: "SAVINGS",
          balance: 1000,
        });

      expect(res.status).toBe(201);
    });

    it("should return 400 for invalid account type", async () => {
      const res = await request(app)
        .post("/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Test",
          type: "INVALID_TYPE",
          balance: 100,
        });

      expect(res.status).toBe(400);
    });

    it("should return 400 for missing required fields", async () => {
      const res = await request(app)
        .post("/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Test" });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /accounts/:id", () => {
    it("should return an account by id", async () => {
      mockAccountRepo.getByIdIncludingArchived.mockResolvedValue(testAccount);

      const res = await request(app)
        .get("/accounts/019576a0-d7b6-7d6d-af6a-2b7545f5ac71")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Savings");
    });

    it("should return 404 for non-existent account", async () => {
      mockAccountRepo.getByIdIncludingArchived.mockResolvedValue(null);

      const res = await request(app)
        .get("/accounts/019576a0-d7b6-7d6d-af6a-000000000000")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /accounts/:id", () => {
    it("should update an account", async () => {
      const updated = new Account({ ...testAccount, name: "Updated" });
      mockAccountRepo.getByIdIncludingArchived.mockResolvedValue(testAccount);
      mockAccountRepo.update.mockResolvedValue(updated);

      const res = await request(app)
        .put("/accounts/019576a0-d7b6-7d6d-af6a-2b7545f5ac71")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Updated" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated");
    });
  });

  describe("DELETE /accounts/:id", () => {
    it("should delete an account", async () => {
      mockAccountRepo.getByIdIncludingArchived.mockResolvedValue(testAccount);
      mockAccountRepo.archiveNonDefault.mockResolvedValue(true);
      mockTransactionRepo.getAllByUserId.mockResolvedValue({
        data: [],
        pagination: {
          limit: 1,
          offset: 0,
          total: 0,
          hasMore: false,
          nextCursor: null,
        },
      });

      const res = await request(app)
        .delete("/accounts/019576a0-d7b6-7d6d-af6a-2b7545f5ac71")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(mockAccountRepo.archiveNonDefault).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        undefined,
      );
    });
  });

  describe("POST /accounts/:id/restore [archive]", () => {
    it("restores an archived account", async () => {
      mockAccountRepo.restore.mockResolvedValue(testAccount);

      const res = await request(app)
        .post("/accounts/019576a0-d7b6-7d6d-af6a-2b7545f5ac71/restore")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(mockAccountRepo.restore).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        testUser.id,
        undefined,
        undefined,
      );
    });

    // The way out of a restore that 409s because the name was taken while the
    // account sat archived: rename it on the way out, in the same write.
    it("restores under a new name when the body carries one", async () => {
      mockAccountRepo.restore.mockResolvedValue(testAccount);

      const res = await request(app)
        .post("/accounts/019576a0-d7b6-7d6d-af6a-2b7545f5ac71/restore")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "  Nequi antiguo  " });

      expect(res.status).toBe(200);
      expect(mockAccountRepo.restore).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        testUser.id,
        "Nequi antiguo",
        undefined,
      );
    });

    it("rejects an empty name instead of restoring under it", async () => {
      const res = await request(app)
        .post("/accounts/019576a0-d7b6-7d6d-af6a-2b7545f5ac71/restore")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "   " });

      expect(res.status).toBe(400);
    });

    it("returns 404 when there is nothing to restore", async () => {
      mockAccountRepo.restore.mockResolvedValue(null);
      mockAccountRepo.getByIdIncludingArchived.mockResolvedValue(null);

      const res = await request(app)
        .post("/accounts/019576a0-d7b6-7d6d-af6a-2b7545f5ac71/restore")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  // ==================== Category Routes ====================
  describe("GET /categories", () => {
    it("should return categories for the authenticated user", async () => {
      mockCategoryRepo.getAllByUserId.mockResolvedValue({
        data: [testCategory],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      });

      const res = await request(app)
        .get("/categories")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination).toBeDefined();
    });
  });

  describe("POST /categories", () => {
    it("should create a category", async () => {
      mockCategoryRepo.create.mockResolvedValue(testCategory);

      const res = await request(app)
        .post("/categories")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Food", icon: "utensils" });

      expect(res.status).toBe(201);
    });

    it("should return 400 for missing name", async () => {
      const res = await request(app)
        .post("/categories")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("GET /categories/:id", () => {
    it("should return a category by id", async () => {
      mockCategoryRepo.getByIdIncludingArchived.mockResolvedValue(testCategory);

      const res = await request(app)
        .get("/categories/019576a0-d7b6-7d6d-af6a-2b7545f5ac73")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Food");
    });

    it("should return 404 for non-existent category", async () => {
      mockCategoryRepo.getByIdIncludingArchived.mockResolvedValue(null);

      const res = await request(app)
        .get("/categories/019576a0-d7b6-7d6d-af6a-000000000000")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /categories/:id", () => {
    it("should update a category", async () => {
      const updated = new Category({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac73",
        name: "Transport",
        icon: "bus",
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      });
      mockCategoryRepo.getByIdIncludingArchived.mockResolvedValue(testCategory);
      mockCategoryRepo.update.mockResolvedValue(updated);

      const res = await request(app)
        .put("/categories/019576a0-d7b6-7d6d-af6a-2b7545f5ac73")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Transport", icon: "bus" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Transport");
      expect(res.body.icon).toBe("bus");
    });
  });

  describe("DELETE /categories/:id", () => {
    it("should delete a category", async () => {
      mockCategoryRepo.getByIdIncludingArchived.mockResolvedValue(testCategory);
      mockCategoryRepo.delete.mockResolvedValue();
      mockTransactionRepo.getAllByUserId.mockResolvedValue({
        data: [],
        pagination: {
          limit: 1,
          offset: 0,
          total: 0,
          hasMore: false,
          nextCursor: null,
        },
      });

      const res = await request(app)
        .delete("/categories/019576a0-d7b6-7d6d-af6a-2b7545f5ac73")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(mockCategoryRepo.delete).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac73",
        undefined,
        undefined,
      );
    });
  });

  // ==================== Transaction Routes ====================
  describe("GET /transactions", () => {
    it("passes the source filter through to the repository", async () => {
      mockTransactionRepo.getAllByUserId.mockResolvedValue({
        data: [],
        pagination: {
          limit: 20,
          offset: 0,
          total: 0,
          hasMore: false,
          nextCursor: null,
        },
      });

      const res = await request(app)
        .get("/transactions?source=QUICK")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(mockTransactionRepo.getAllByUserId).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        expect.anything(),
        expect.objectContaining({ source: "QUICK" }),
      );
    });

    it("asks the repository for a summary only when requested", async () => {
      const empty = {
        data: [],
        pagination: {
          limit: 20,
          offset: 0,
          total: 0,
          hasMore: false,
          nextCursor: null,
        },
      };
      mockTransactionRepo.getAllByUserId.mockResolvedValue(empty);

      await request(app)
        .get("/transactions?pendingDetails=true")
        .set("Authorization", `Bearer ${token}`);
      expect(mockTransactionRepo.getAllByUserId).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        expect.not.objectContaining({ includeSummary: true }),
      );

      await request(app)
        .get("/transactions?pendingDetails=true&includeSummary=true")
        .set("Authorization", `Bearer ${token}`);
      expect(mockTransactionRepo.getAllByUserId).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ includeSummary: true, pendingDetails: true }),
      );
    });

    it("passes the summary through to the client", async () => {
      mockTransactionRepo.getAllByUserId.mockResolvedValue({
        data: [],
        pagination: {
          limit: 1,
          offset: 0,
          total: 3,
          hasMore: true,
          nextCursor: null,
        },
        summary: { totalAmount: 47_900 },
      });

      const res = await request(app)
        .get("/transactions?pendingDetails=true&includeSummary=true&limit=1")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.summary).toEqual({ totalAmount: 47_900 });
      expect(res.body.pagination.total).toBe(3);
    });

    it("names the field without the schema section it came from", async () => {
      const res = await request(app)
        .post("/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({ type: "EXPENSE", amount: -5, date: "not-a-date" });

      expect(res.status).toBe(400);
      const fields = res.body.details.map(
        (d: { field: string }) => d.field,
      ) as string[];
      expect(fields).toContain("amount");
      expect(fields.every((f) => !f.startsWith("body."))).toBe(true);
    });

    it("rejects an unknown source", async () => {
      const res = await request(app)
        .get("/transactions?source=SMS")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
    });

    it("should return transactions for the authenticated user", async () => {
      mockTransactionRepo.getAllByUserId.mockResolvedValue({
        data: [testTransaction],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      });

      const res = await request(app)
        .get("/transactions")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination).toBeDefined();
    });

    it("rejects uncategorized=true combined with categoryId", async () => {
      const res = await request(app)
        .get(
          "/transactions?uncategorized=true&categoryId=019576a0-d7b6-7d6d-af6a-2b7545f5ac73",
        )
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  describe("POST /transactions", () => {
    it("rejects a malformed Idempotency-Key with IDEMPOTENCY_KEY_INVALID", async () => {
      mockAccountRepo.getById.mockResolvedValue(testAccount);
      mockTransactionRepo.create.mockResolvedValue(testTransaction);

      const res = await request(app)
        .post("/transactions")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "bad key with spaces!")
        .send({
          type: "EXPENSE",
          amount: 50,
          date: "2026-03-28T00:00:00.000Z",
          fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("IDEMPOTENCY_KEY_INVALID");
    });

    it("should create an expense transaction", async () => {
      mockAccountRepo.getById.mockResolvedValue(testAccount);
      mockTransactionRepo.create.mockResolvedValue(testTransaction);

      const res = await request(app)
        .post("/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          type: "EXPENSE",
          amount: 50,
          date: "2026-03-28T00:00:00.000Z",
          fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        });

      expect(res.status).toBe(201);
    });

    it("should return 400 for invalid transaction type", async () => {
      const res = await request(app)
        .post("/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          type: "INVALID",
          amount: 50,
          date: "2026-03-28T00:00:00.000Z",
          fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        });

      expect(res.status).toBe(400);
    });

    it("should return 400 for missing required fields", async () => {
      const res = await request(app)
        .post("/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({ type: "EXPENSE" });

      expect(res.status).toBe(400);
    });

    it("should return 400 for expense without fromAccountId", async () => {
      const res = await request(app)
        .post("/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          type: "EXPENSE",
          amount: 50,
          date: "2026-03-28T00:00:00.000Z",
        });

      expect(res.status).toBe(400);
    });

    it("should return 400 for transfer with same from and to account", async () => {
      const res = await request(app)
        .post("/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          type: "TRANSFER",
          amount: 50,
          date: "2026-03-28T00:00:00.000Z",
          fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
          toAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /transactions/:id", () => {
    it("should return a transaction by id", async () => {
      mockTransactionRepo.getById.mockResolvedValue(testTransaction);

      const res = await request(app)
        .get("/transactions/019576a0-d7b6-7d6d-af6a-2b7545f5ac74")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.type).toBe("EXPENSE");
    });

    it("should return 404 for non-existent transaction", async () => {
      mockTransactionRepo.getById.mockResolvedValue(null);

      const res = await request(app)
        .get("/transactions/019576a0-d7b6-7d6d-af6a-000000000000")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /transactions/:id", () => {
    it("should update a transaction", async () => {
      mockTransactionRepo.getById.mockResolvedValue(testTransaction);
      mockAccountRepo.getById.mockResolvedValue(testAccount);
      mockCategoryRepo.getByIdIncludingArchived.mockResolvedValue(testCategory);
      const updated = new Transaction({ ...testTransaction, amount: 75 });
      mockTransactionRepo.update.mockResolvedValue(updated);

      const res = await request(app)
        .put("/transactions/019576a0-d7b6-7d6d-af6a-2b7545f5ac74")
        .set("Authorization", `Bearer ${token}`)
        .send({ amount: 75 });

      expect(res.status).toBe(200);
    });
  });

  describe("DELETE /transactions/:id", () => {
    it("should delete a transaction", async () => {
      mockTransactionRepo.getById.mockResolvedValue(testTransaction);
      mockAccountRepo.getById.mockResolvedValue(testAccount);
      mockTransactionRepo.delete.mockResolvedValue();

      const res = await request(app)
        .delete("/transactions/019576a0-d7b6-7d6d-af6a-2b7545f5ac74")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(mockTransactionRepo.delete).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac74",
        expect.anything(),
        undefined,
      );
    });
  });

  // ==================== Stats Routes ====================
  describe("GET /stats/spending [F1]", () => {
    it("returns spending buckets grouped by category", async () => {
      mockTransactionRepo.aggregateSpending.mockResolvedValue({
        buckets: [{ key: "cat-1", total: 30.5, count: 3, avg: 10.17 }],
        totalCents: 3050,
      });

      const res = await request(app)
        .get("/stats/spending?groupBy=category")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.groupBy).toBe("category");
      expect(res.body.buckets).toHaveLength(1);
      expect(res.body.total).toBe(30.5);
      expect(mockTransactionRepo.aggregateSpending).toHaveBeenCalledWith(
        testUser.id,
        expect.objectContaining({ groupBy: "category", type: "EXPENSE" }),
      );
    });

    it("rejects an invalid groupBy", async () => {
      const res = await request(app)
        .get("/stats/spending?groupBy=nope")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  // ==================== Budget Routes ====================
  describe("Budgets [F3]", () => {
    const testBudget = new Budget({
      id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac90",
      name: "Food",
      color: "RED",
      categoryIds: ["019576a0-d7b6-7d6d-af6a-2b7545f5ac73"],
      amount: 500,
      periodType: "MONTHLY",
      userId: testUser.id,
    });

    beforeEach(() => {
      mockUserRepo.getById.mockResolvedValue(testUser);
      mockTransactionRepo.sumAmountsByCategory.mockResolvedValue({});
    });

    it("lists budgets with computed spent", async () => {
      mockBudgetRepo.getAllByUserId.mockResolvedValue({
        data: [testBudget],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      });
      mockTransactionRepo.sumAmountsByCategory.mockResolvedValue({
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac73": 12000,
      });

      const res = await request(app)
        .get("/budgets")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].spent).toBe(120);
      expect(res.body.data[0].amount).toBe(500);
    });

    it("creates a budget", async () => {
      mockBudgetRepo.findOverlapping.mockResolvedValue([]);
      mockBudgetRepo.create.mockResolvedValue(testBudget);
      mockCategoryRepo.getByIdIncludingArchived.mockResolvedValue(testCategory);

      const res = await request(app)
        .post("/budgets")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Food",
          color: "RED",
          categoryIds: ["019576a0-d7b6-7d6d-af6a-2b7545f5ac73"],
          amount: 500,
          periodType: "MONTHLY",
        });

      expect(res.status).toBe(201);
    });

    it("rejects a duplicate budget (same category + period)", async () => {
      mockBudgetRepo.findOverlapping.mockResolvedValue([testBudget]);
      mockCategoryRepo.getByIdIncludingArchived.mockResolvedValue(testCategory);

      const res = await request(app)
        .post("/budgets")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Food 2",
          color: "TEAL",
          categoryIds: ["019576a0-d7b6-7d6d-af6a-2b7545f5ac73"],
          amount: 300,
          periodType: "MONTHLY",
        });

      expect(res.status).toBe(400);
    });
  });
  // ==================== Client-minted ids (O-B1) ====================
  describe("Client-minted ids [O-B1]", () => {
    const CLIENT_ID = "019576a0-d7b6-7d6d-af6a-2b7545f5ac71";
    const dupKey = (keyPattern: Record<string, number>): Error =>
      Object.assign(new Error("E11000 duplicate key"), {
        name: "MongoServerError",
        code: 11000,
        keyPattern,
      });
    const accountBody = {
      id: CLIENT_ID,
      name: "Savings",
      type: "SAVINGS",
      balance: 1000,
    };

    beforeEach(() => {
      mockUserRepo.getById.mockResolvedValue(testUser);
      mockTransactionRepo.sumAmountsByCategory.mockResolvedValue({});
    });

    it("stores the id the client sent", async () => {
      mockAccountRepo.getOwnById.mockResolvedValue(null);
      mockAccountRepo.create.mockResolvedValue(testAccount);

      const res = await request(app)
        .post("/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send(accountBody);

      expect(res.status).toBe(201);
      expect(mockAccountRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: CLIENT_ID }),
      );
    });

    it("rejects an id that is not a UUID", async () => {
      const res = await request(app)
        .post("/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...accountBody, id: "not-a-uuid" });

      expect(res.status).toBe(400);
      expect(mockAccountRepo.create).not.toHaveBeenCalled();
    });

    it("replays an identical create with 200 and does not write again", async () => {
      mockAccountRepo.getOwnById.mockResolvedValue(testAccount);

      const res = await request(app)
        .post("/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send(accountBody);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(CLIENT_ID);
      expect(mockAccountRepo.create).not.toHaveBeenCalled();
    });

    it("answers 409 ID_TAKEN when the same id carries a different payload", async () => {
      mockAccountRepo.getOwnById.mockResolvedValue(testAccount);

      const res = await request(app)
        .post("/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...accountBody, name: "Renamed" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ID_TAKEN");
      expect(mockAccountRepo.create).not.toHaveBeenCalled();
    });

    // A leak here would tell the caller that someone else's resource exists,
    // and the message would describe it.
    it("answers an opaque 409 ID_TAKEN for another user's id, without reading it", async () => {
      mockAccountRepo.getOwnById.mockResolvedValue(null);
      mockAccountRepo.create.mockRejectedValue(dupKey({ _id: 1 }));

      const res = await request(app)
        .post("/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send(accountBody);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ID_TAKEN");
      expect(res.body).toEqual({
        error: "ConflictError",
        message: "That id is already in use; retry with a new one",
        code: "ID_TAKEN",
      });
      expect(mockAccountRepo.getById).not.toHaveBeenCalled();
      expect(mockAccountRepo.getByIdIncludingArchived).not.toHaveBeenCalled();
      expect(mockAccountRepo.getOwnById).toHaveBeenCalledWith(
        CLIENT_ID,
        testUser.id,
      );
    });

    it("still reports a duplicate name as DUPLICATE, not ID_TAKEN", async () => {
      mockAccountRepo.getOwnById.mockResolvedValue(null);
      mockAccountRepo.create.mockRejectedValue(dupKey({ userId: 1, name: 1 }));

      const res = await request(app)
        .post("/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send(accountBody);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("DUPLICATE");
    });

    it("replays a category create", async () => {
      mockCategoryRepo.getOwnById.mockResolvedValue(testCategory);

      const res = await request(app)
        .post("/categories")
        .set("Authorization", `Bearer ${token}`)
        .send({ id: testCategory.id, name: "Food", icon: "utensils" });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(testCategory.id);
      expect(mockCategoryRepo.create).not.toHaveBeenCalled();
    });

    it("rejects a category replay whose icon changed", async () => {
      mockCategoryRepo.getOwnById.mockResolvedValue(testCategory);

      const res = await request(app)
        .post("/categories")
        .set("Authorization", `Bearer ${token}`)
        .send({ id: testCategory.id, name: "Food", icon: "car" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ID_TAKEN");
    });

    it("replays a transaction create without touching balances", async () => {
      mockTransactionRepo.getOwnById.mockResolvedValue(testTransaction);

      const res = await request(app)
        .post("/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          id: testTransaction.id,
          type: "EXPENSE",
          amount: 50,
          date: "2026-03-28T00:00:00.000Z",
          fromAccountId: testTransaction.fromAccountId,
          categoryId: testTransaction.categoryId,
          description: "Groceries",
        });

      expect(res.status).toBe(200);
      expect(mockTransactionRepo.create).not.toHaveBeenCalled();
      expect(mockAccountRepo.incrementBalance).not.toHaveBeenCalled();
    });

    // The unsent date and account resolve to `now` and to the current default
    // account, so comparing them would fail every legitimate replay.
    it("replays a quick-add on the fields the client actually sent", async () => {
      mockTransactionRepo.getOwnById.mockResolvedValue(
        new Transaction({ ...testTransaction, source: "QUICK" }),
      );

      const res = await request(app)
        .post("/transactions/quick")
        .set("Authorization", `Bearer ${token}`)
        .send({ id: testTransaction.id, amount: 50 });

      expect(res.status).toBe(200);
      expect(mockTransactionRepo.create).not.toHaveBeenCalled();
      expect(mockAccountRepo.getDefaultByUserId).not.toHaveBeenCalled();
    });

    it("rejects a quick-add replay of a transaction that was not a quick-add", async () => {
      mockTransactionRepo.getOwnById.mockResolvedValue(testTransaction);

      const res = await request(app)
        .post("/transactions/quick")
        .set("Authorization", `Bearer ${token}`)
        .send({ id: testTransaction.id, amount: 50 });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ID_TAKEN");
    });

    it("replays a budget create without re-running the overlap rule", async () => {
      const budget = new Budget({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac90",
        name: "Food",
        color: "RED",
        categoryIds: [testCategory.id],
        amount: 500,
        periodType: "MONTHLY",
        userId: testUser.id,
      });
      mockBudgetRepo.getOwnById.mockResolvedValue(budget);

      const res = await request(app)
        .post("/budgets")
        .set("Authorization", `Bearer ${token}`)
        .send({
          id: budget.id,
          name: "Food",
          color: "RED",
          categoryIds: [testCategory.id],
          amount: 500,
          periodType: "MONTHLY",
        });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(budget.id);
      expect(mockBudgetRepo.create).not.toHaveBeenCalled();
      expect(mockBudgetRepo.findOverlapping).not.toHaveBeenCalled();
    });

    it("rejects a budget replay whose amount changed", async () => {
      const budget = new Budget({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac90",
        name: "Food",
        color: "RED",
        categoryIds: [testCategory.id],
        amount: 500,
        periodType: "MONTHLY",
        userId: testUser.id,
      });
      mockBudgetRepo.getOwnById.mockResolvedValue(budget);

      const res = await request(app)
        .post("/budgets")
        .set("Authorization", `Bearer ${token}`)
        .send({
          id: budget.id,
          name: "Food",
          color: "RED",
          categoryIds: [testCategory.id],
          amount: 900,
          periodType: "MONTHLY",
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ID_TAKEN");
    });
  });

  // ==================== Optimistic concurrency (O-B2) ====================
  describe("If-Match [O-B2]", () => {
    const V1 = new Date("2026-01-01T00:00:00.000Z");
    const V2 = new Date("2026-02-02T00:00:00.000Z");
    const ACC = "019576a0-d7b6-7d6d-af6a-2b7545f5ac71";
    const at = (updatedAt: Date): Account =>
      new Account({ ...testAccount, updatedAt, archivedAt: null });

    beforeEach(() => {
      mockUserRepo.getById.mockResolvedValue(testUser);
      mockTransactionRepo.sumAmountsByCategory.mockResolvedValue({});
    });

    it("writes normally when the header matches", async () => {
      mockAccountRepo.getByIdIncludingArchived.mockResolvedValue(at(V1));
      mockAccountRepo.update.mockResolvedValue(at(V2));

      const res = await request(app)
        .put(`/accounts/${ACC}`)
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", V1.toISOString())
        .send({ name: "Renamed" });

      expect(res.status).toBe(200);
      // The guard travels into the write's own filter, not just the check above.
      expect(mockAccountRepo.update).toHaveBeenCalledWith(
        ACC,
        { name: "Renamed" },
        undefined,
        V1,
      );
    });

    it("answers 409 STALE_UPDATE carrying the server's version", async () => {
      mockAccountRepo.getByIdIncludingArchived.mockResolvedValue(at(V2));

      const res = await request(app)
        .put(`/accounts/${ACC}`)
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", V1.toISOString())
        .send({ name: "Renamed" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("STALE_UPDATE");
      expect(res.body.current).toMatchObject({
        id: ACC,
        name: "Savings",
        updatedAt: V2.toISOString(),
      });
      expect(mockAccountRepo.update).not.toHaveBeenCalled();
    });

    it("rejects a malformed header with 400, not a silent 409", async () => {
      mockAccountRepo.getByIdIncludingArchived.mockResolvedValue(at(V1));

      const res = await request(app)
        .put(`/accounts/${ACC}`)
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", "2026-01-01")
        .send({ name: "Renamed" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION");
      expect(res.body.details).toEqual([
        { field: "If-Match", message: expect.any(String) },
      ]);
      expect(mockAccountRepo.update).not.toHaveBeenCalled();
    });

    // Losing the race is the case the pre-check cannot see: the filter did.
    it("turns a write whose filter matched nothing into 409, not 404", async () => {
      mockAccountRepo.getByIdIncludingArchived.mockResolvedValue(at(V1));
      mockAccountRepo.update.mockRejectedValue(
        new ApiError("NotFound", "Account not found"),
      );
      mockAccountRepo.getOwnById.mockResolvedValue(at(V2));

      const res = await request(app)
        .put(`/accounts/${ACC}`)
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", V1.toISOString())
        .send({ name: "Renamed" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("STALE_UPDATE");
    });

    it("keeps 404 when the resource is really gone", async () => {
      mockAccountRepo.getByIdIncludingArchived.mockResolvedValue(at(V1));
      mockAccountRepo.update.mockRejectedValue(
        new ApiError("NotFound", "Account not found"),
      );
      mockAccountRepo.getOwnById.mockResolvedValue(null);

      const res = await request(app)
        .put(`/accounts/${ACC}`)
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", V1.toISOString())
        .send({ name: "Renamed" });

      expect(res.status).toBe(404);
    });

    // Stale wins over RESOURCE_ARCHIVED: the caller cannot know about a state
    // it has not read yet, and re-reading tells it everything.
    it("prefers STALE_UPDATE over the archived guard", async () => {
      mockAccountRepo.getByIdIncludingArchived.mockResolvedValue(
        new Account({ ...testAccount, updatedAt: V2, archivedAt: new Date() }),
      );

      const res = await request(app)
        .put(`/accounts/${ACC}`)
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", V1.toISOString())
        .send({ name: "Renamed" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("STALE_UPDATE");
    });

    it("guards the archive, the restore and the default flag", async () => {
      mockAccountRepo.getByIdIncludingArchived.mockResolvedValue(at(V1));
      mockAccountRepo.archiveNonDefault.mockResolvedValue(true);
      await request(app)
        .delete(`/accounts/${ACC}`)
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", V1.toISOString());
      expect(mockAccountRepo.archiveNonDefault).toHaveBeenCalledWith(
        ACC,
        testUser.id,
        V1,
      );

      mockAccountRepo.restore.mockResolvedValue(at(V2));
      await request(app)
        .post(`/accounts/${ACC}/restore`)
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", V1.toISOString())
        .send({});
      expect(mockAccountRepo.restore).toHaveBeenCalledWith(
        ACC,
        testUser.id,
        undefined,
        V1,
      );

      mockAccountRepo.setDefault.mockResolvedValue(at(V2));
      await request(app)
        .post(`/accounts/${ACC}/default`)
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", V1.toISOString());
      expect(mockAccountRepo.setDefault).toHaveBeenCalledWith(
        ACC,
        testUser.id,
        V1,
      );
    });

    it("guards a category update", async () => {
      mockCategoryRepo.getByIdIncludingArchived.mockResolvedValue(
        new Category({ ...testCategory, updatedAt: V2 }),
      );

      const res = await request(app)
        .put(`/categories/${testCategory.id}`)
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", V1.toISOString())
        .send({ name: "Comida" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("STALE_UPDATE");
      expect(res.body.current.id).toBe(testCategory.id);
      expect(mockCategoryRepo.update).not.toHaveBeenCalled();
    });

    it("guards a transaction update without touching balances", async () => {
      mockTransactionRepo.getById.mockResolvedValue(
        new Transaction({ ...testTransaction, updatedAt: V2 }),
      );

      const res = await request(app)
        .put(`/transactions/${testTransaction.id}`)
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", V1.toISOString())
        .send({ amount: 99 });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("STALE_UPDATE");
      expect(mockTransactionRepo.update).not.toHaveBeenCalled();
      expect(mockAccountRepo.incrementBalance).not.toHaveBeenCalled();
    });

    // A deleted transaction has no `deletedAt` in its API shape, so a 409
    // carrying it would look like a live transaction. 404 is the honest answer,
    // and it is also what the route says today without a guard.
    it("answers 404, not 409, when the transaction was already deleted", async () => {
      mockTransactionRepo.getById.mockResolvedValue(null);

      const res = await request(app)
        .delete(`/transactions/${testTransaction.id}`)
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", V1.toISOString());

      expect(res.status).toBe(404);
      expect(res.body.code).toBeUndefined();
      expect(mockAccountRepo.incrementBalance).not.toHaveBeenCalled();
    });

    it("guards a budget update and answers with the budget view", async () => {
      mockBudgetRepo.getByIdIncludingArchived.mockResolvedValue(
        new Budget({
          id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac90",
          name: "Food",
          color: "RED",
          categoryIds: [testCategory.id],
          amount: 500,
          periodType: "MONTHLY",
          userId: testUser.id,
          updatedAt: V2,
        }),
      );

      const res = await request(app)
        .put("/budgets/019576a0-d7b6-7d6d-af6a-2b7545f5ac90")
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", V1.toISOString())
        .send({ amount: 900 });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("STALE_UPDATE");
      // The view, not the raw document: same shape as GET /budgets/:id.
      expect(res.body.current).toMatchObject({
        baseAmount: 500,
        spent: 0,
        periodKey: expect.any(String),
      });
      expect(mockBudgetRepo.update).not.toHaveBeenCalled();
    });
  });

  // ==================== Incremental sync feed (O-B3) ====================
  describe("GET /sync/changes", () => {
    const SNAPSHOT_CURSOR = undefined;

    beforeEach(() => {
      mockUserRepo.getById.mockResolvedValue(testUser);
      mockAccountRepo.changesSince.mockResolvedValue([testAccount]);
      mockCategoryRepo.changesSince.mockResolvedValue([testCategory]);
      mockTransactionRepo.changesSince.mockResolvedValue([
        Object.assign(testTransaction, { deletedAt: null }),
      ]);
      mockBudgetRepo.changesSince.mockResolvedValue([]);
    });

    it("returns a full snapshot when no position is given", async () => {
      const res = await request(app)
        .get("/sync/changes")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body.changes)).toEqual([
        "user",
        "accounts",
        "categories",
        "transactions",
        "budgets",
      ]);
      expect(res.body.changes.user.id).toBe(testUser.id);
      expect(res.body.changes.user.password).toBeUndefined();
      expect(res.body.serverTime).toEqual(expect.any(String));
      expect(mockAccountRepo.changesSince).toHaveBeenCalledWith(
        testUser.id,
        SNAPSHOT_CURSOR,
        201,
      );
    });

    it("turns ?since= into an exclusive lower bound on updatedAt", async () => {
      const res = await request(app)
        .get("/sync/changes?since=2026-05-01T00:00:00.000Z")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(mockAccountRepo.changesSince).toHaveBeenCalledWith(
        testUser.id,
        { updatedAt: new Date("2026-05-01T00:00:00.000Z"), id: null },
        201,
      );
    });

    it("lets the cursor win over ?since=: it is the more precise position", async () => {
      const first = await request(app)
        .get("/sync/changes?limit=1")
        .set("Authorization", `Bearer ${token}`);
      const cursor = first.body.pagination.nextCursor as string;

      const res = await request(app)
        .get(`/sync/changes?since=1999-01-01T00:00:00.000Z&cursor=${cursor}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const calls = mockAccountRepo.changesSince.mock.calls;
      const passed = calls[calls.length - 1]?.[1];
      expect(passed?.updatedAt.getFullYear()).not.toBe(1999);
    });

    // Serving page one for a cursor the server cannot read is how a client
    // silently loops over the same rows forever.
    it("rejects an unreadable cursor with 400 INVALID_CURSOR", async () => {
      const res = await request(app)
        .get("/sync/changes?cursor=not-a-real-cursor")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CURSOR");
      expect(mockAccountRepo.changesSince).not.toHaveBeenCalled();
    });

    it("rejects a limit past the ceiling instead of silently clamping it", async () => {
      const res = await request(app)
        .get("/sync/changes?limit=5000")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION");
      expect(res.body.details[0].field).toBe("limit");
    });

    it("reports deletions and archives, which no other endpoint does", async () => {
      mockAccountRepo.changesSince.mockResolvedValue([
        new Account({
          id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac79",
          name: "Old wallet",
          type: "CASH",
          balance: 0,
          userId: testUser.id,
          archivedAt: new Date("2026-02-01"),
          updatedAt: new Date("2026-02-01"),
        }),
      ]);
      mockTransactionRepo.changesSince.mockResolvedValue([
        Object.assign(
          new Transaction({
            id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac78",
            type: "EXPENSE",
            amount: 5,
            date: new Date("2026-02-01"),
            fromAccountId: testAccount.id,
            userId: testUser.id,
            updatedAt: new Date("2026-02-02"),
          }),
          { deletedAt: new Date("2026-02-02") },
        ),
      ]);

      const res = await request(app)
        .get("/sync/changes")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.changes.accounts[0].archivedAt).toBe(
        new Date("2026-02-01").toISOString(),
      );
      expect(res.body.changes.transactions[0].deletedAt).toBe(
        new Date("2026-02-02").toISOString(),
      );
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/sync/changes");

      expect(res.status).toBe(401);
    });
  });
});
