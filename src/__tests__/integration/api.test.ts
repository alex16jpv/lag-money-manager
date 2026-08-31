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
    RED: "RED", ORANGE: "ORANGE", AMBER: "AMBER", YELLOW: "YELLOW",
    LIME: "LIME", GREEN: "GREEN", TEAL: "TEAL", CYAN: "CYAN",
    BLUE: "BLUE", INDIGO: "INDIGO", PURPLE: "PURPLE", PINK: "PINK",
    ROSE: "ROSE", GRAY: "GRAY", BROWN: "BROWN", BLACK: "BLACK",
  },
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
  emoji: "🍔",
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
        { userId: testUser.id, tokenVersion: testUser.tokenVersion, type: "refresh", jti: "jti-1" },
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
        { userId: testUser.id, tokenVersion: 99, type: "refresh", jti: "jti-1" },
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
        pagination: { limit: 1, offset: 0, total: 0, hasMore: false, nextCursor: null },
      });

      const res = await request(app)
        .delete("/accounts/019576a0-d7b6-7d6d-af6a-2b7545f5ac71")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(mockAccountRepo.archiveNonDefault).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
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
      );
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
        .send({ name: "Food", emoji: "🍔" });

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
        emoji: "🚌",
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      });
      mockCategoryRepo.getByIdIncludingArchived.mockResolvedValue(testCategory);
      mockCategoryRepo.update.mockResolvedValue(updated);

      const res = await request(app)
        .put("/categories/019576a0-d7b6-7d6d-af6a-2b7545f5ac73")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Transport", emoji: "🚌" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Transport");
      expect(res.body.emoji).toBe("🚌");
    });
  });

  describe("DELETE /categories/:id", () => {
    it("should delete a category", async () => {
      mockCategoryRepo.getByIdIncludingArchived.mockResolvedValue(testCategory);
      mockCategoryRepo.delete.mockResolvedValue();
      mockTransactionRepo.getAllByUserId.mockResolvedValue({
        data: [],
        pagination: { limit: 1, offset: 0, total: 0, hasMore: false, nextCursor: null },
      });

      const res = await request(app)
        .delete("/categories/019576a0-d7b6-7d6d-af6a-2b7545f5ac73")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(mockCategoryRepo.delete).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac73",
      );
    });
  });

  // ==================== Transaction Routes ====================
  describe("GET /transactions", () => {
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
        pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextCursor: null },
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
});
