import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { User } from "../../domain/entities/User";
import { Account } from "../../domain/entities/Account";
import { Category } from "../../domain/entities/Category";
import bcryptjs from "bcryptjs";

// --- Mock repositories ---
const mockUserRepo: jest.Mocked<IUserRepository> = {
  getAll: jest.fn(),
  getById: jest.fn(),
  getByEmail: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const mockAccountRepo: jest.Mocked<IAccountRepository> = {
  getAll: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const mockCategoryRepo: jest.Mocked<ICategoryRepository> = {
  getAll: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

// --- Mock modules before importing app ---
jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    PORT: 3000,
    DB_TYPE: "SEQ",
    JWT_SECRET: "test-secret-for-integration",
  },
  DB_TYPES: { SEQ: "SEQ", MONGO: "MONGO", LOCAL_STORAGE: "LOCAL_STORAGE" },
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

jest.mock("../../shared/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

jest.mock("../../domain/models/index", () => ({
  loadSequelizeModels: jest.fn(),
}));

jest.mock("../../app/factories/RepositoryFactory", () => ({
  __esModule: true,
  default: {
    getUserRepository: () => mockUserRepo,
    getAccountRepository: () => mockAccountRepo,
    getCategoryRepository: () => mockCategoryRepo,
  },
  RepositoryFactory: jest.fn(),
}));

import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../app";

const generateToken = (userId: number = 1, email: string = "test@test.com") =>
  jwt.sign({ userId, email }, "test-secret-for-integration", {
    expiresIn: "1h",
  });

// --- Test data ---
const testUser = new User({
  id: 1,
  name: "John Doe",
  email: "john@example.com",
  password: bcryptjs.hashSync("password123", 12),
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

const testAccount = new Account({
  id: 1,
  name: "Savings",
  type: "SAVINGS",
  balance: 1000,
  userId: 1,
});

const testCategory = new Category({ id: 1, name: "Food" });

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
      expect(res.body.token).toBeDefined();
      expect(typeof res.body.token).toBe("string");
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
  });

  // ==================== User Routes ====================
  describe("GET /users", () => {
    it("should return all users", async () => {
      mockUserRepo.getAll.mockResolvedValue([testUser]);

      const res = await request(app)
        .get("/users")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe("GET /users/:id", () => {
    it("should return a user by id", async () => {
      mockUserRepo.getById.mockResolvedValue(testUser);

      const res = await request(app)
        .get("/users/1")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("John Doe");
    });

    it("should return 404 for non-existent user", async () => {
      mockUserRepo.getById.mockResolvedValue(null);

      const res = await request(app)
        .get("/users/999")
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

  describe("POST /users", () => {
    it("should create a user", async () => {
      mockUserRepo.create.mockResolvedValue(testUser);

      const res = await request(app)
        .post("/users")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "John Doe",
          email: "john@example.com",
          password: "password123",
        });

      expect(res.status).toBe(201);
    });

    it("should return 400 for invalid body", async () => {
      const res = await request(app)
        .post("/users")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "" });

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /users/:id", () => {
    it("should update a user", async () => {
      const updatedUser = new User({ ...testUser, name: "Updated" });
      mockUserRepo.update.mockResolvedValue(updatedUser);

      const res = await request(app)
        .put("/users/1")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Updated" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated");
    });

    it("should return 400 for empty update body", async () => {
      const res = await request(app)
        .put("/users/1")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /users/:id", () => {
    it("should delete a user", async () => {
      mockUserRepo.delete.mockResolvedValue();

      const res = await request(app)
        .delete("/users/1")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(204);
      expect(mockUserRepo.delete).toHaveBeenCalledWith(1);
    });
  });

  // ==================== Account Routes ====================
  describe("GET /accounts", () => {
    it("should return all accounts", async () => {
      mockAccountRepo.getAll.mockResolvedValue([testAccount]);

      const res = await request(app)
        .get("/accounts")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
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
          userId: 1,
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
          userId: 1,
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
      mockAccountRepo.getById.mockResolvedValue(testAccount);

      const res = await request(app)
        .get("/accounts/1")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Savings");
    });

    it("should return 404 for non-existent account", async () => {
      mockAccountRepo.getById.mockResolvedValue(null);

      const res = await request(app)
        .get("/accounts/999")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /accounts/:id", () => {
    it("should update an account", async () => {
      const updated = new Account({ ...testAccount, name: "Updated" });
      mockAccountRepo.update.mockResolvedValue(updated);

      const res = await request(app)
        .put("/accounts/1")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Updated" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated");
    });
  });

  describe("DELETE /accounts/:id", () => {
    it("should delete an account", async () => {
      mockAccountRepo.delete.mockResolvedValue();

      const res = await request(app)
        .delete("/accounts/1")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(204);
      expect(mockAccountRepo.delete).toHaveBeenCalledWith(1);
    });
  });

  // ==================== Category Routes ====================
  describe("GET /categories", () => {
    it("should return all categories", async () => {
      mockCategoryRepo.getAll.mockResolvedValue([testCategory]);

      const res = await request(app)
        .get("/categories")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe("POST /categories", () => {
    it("should create a category", async () => {
      mockCategoryRepo.create.mockResolvedValue(testCategory);

      const res = await request(app)
        .post("/categories")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Food" });

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
      mockCategoryRepo.getById.mockResolvedValue(testCategory);

      const res = await request(app)
        .get("/categories/1")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Food");
    });

    it("should return 404 for non-existent category", async () => {
      mockCategoryRepo.getById.mockResolvedValue(null);

      const res = await request(app)
        .get("/categories/999")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /categories/:id", () => {
    it("should update a category", async () => {
      const updated = new Category({ id: 1, name: "Transport" });
      mockCategoryRepo.update.mockResolvedValue(updated);

      const res = await request(app)
        .put("/categories/1")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Transport" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Transport");
    });
  });

  describe("DELETE /categories/:id", () => {
    it("should delete a category", async () => {
      mockCategoryRepo.delete.mockResolvedValue();

      const res = await request(app)
        .delete("/categories/1")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(204);
      expect(mockCategoryRepo.delete).toHaveBeenCalledWith(1);
    });
  });
});
