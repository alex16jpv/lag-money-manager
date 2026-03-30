import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "lag-money-manager API",
      version: "1.0.0",
      description: "REST API for personal money management",
    },
    servers: [
      {
        url: "/",
        description: "Current server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        User: {
          type: "object",
          properties: {
            id: {
              type: "string",
              format: "uuid",
              example: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
            },
            name: { type: "string", example: "John Doe" },
            email: {
              type: "string",
              format: "email",
              example: "john@example.com",
            },
            createdAt: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T00:00:00.000Z",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
              example: "2026-01-01T00:00:00.000Z",
            },
          },
        },
        CreateUser: {
          type: "object",
          required: ["name", "email", "password"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 255 },
            email: { type: "string", format: "email", maxLength: 255 },
            password: { type: "string", minLength: 8, maxLength: 128 },
          },
        },
        UpdateUser: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 255 },
            email: { type: "string", format: "email", maxLength: 255 },
            password: { type: "string", minLength: 8, maxLength: 128 },
          },
        },
        Account: {
          type: "object",
          properties: {
            id: {
              type: "string",
              format: "uuid",
              example: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
            },
            name: { type: "string", example: "Savings" },
            type: {
              type: "string",
              enum: [
                "CASH",
                "ACCOUNT",
                "CARD",
                "DEBIT_CARD",
                "SAVINGS",
                "INVESTMENT",
                "OVERDRAFT",
                "LOAN",
                "OTHER",
              ],
              example: "SAVINGS",
            },
            balance: { type: "number", example: 1000 },
            userId: {
              type: "string",
              format: "uuid",
              example: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
            },
          },
        },
        CreateAccount: {
          type: "object",
          required: ["name", "type"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 255 },
            type: {
              type: "string",
              enum: [
                "CASH",
                "ACCOUNT",
                "CARD",
                "DEBIT_CARD",
                "SAVINGS",
                "INVESTMENT",
                "OVERDRAFT",
                "LOAN",
                "OTHER",
              ],
            },
            balance: { type: "number", default: 0 },
          },
        },
        UpdateAccount: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 255 },
            type: {
              type: "string",
              enum: [
                "CASH",
                "ACCOUNT",
                "CARD",
                "DEBIT_CARD",
                "SAVINGS",
                "INVESTMENT",
                "OVERDRAFT",
                "LOAN",
                "OTHER",
              ],
            },
            balance: { type: "number" },
          },
        },
        Category: {
          type: "object",
          properties: {
            id: {
              type: "string",
              format: "uuid",
              example: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
            },
            name: { type: "string", example: "Food" },
            userId: {
              type: "string",
              format: "uuid",
              example: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
            },
          },
        },
        CreateCategory: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 255 },
          },
        },
        UpdateCategory: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 255 },
          },
        },
        RegisterRequest: {
          type: "object",
          required: ["name", "email", "password"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 255 },
            email: { type: "string", format: "email", maxLength: 255 },
            password: { type: "string", minLength: 8, maxLength: 128 },
          },
        },
        LoginRequest: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8, maxLength: 128 },
          },
        },
        LoginResponse: {
          type: "object",
          properties: {
            token: { type: "string" },
            user: { $ref: "#/components/schemas/User" },
          },
        },
        ValidationError: {
          type: "object",
          properties: {
            error: { type: "string", example: "ValidationError" },
            message: { type: "string", example: "Invalid request data" },
            details: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        Pagination: {
          type: "object",
          properties: {
            limit: { type: "integer", example: 20 },
            offset: { type: "integer", example: 0 },
            total: { type: "integer", example: 100 },
            hasMore: { type: "boolean", example: true },
            nextCursor: {
              type: "string",
              format: "uuid",
              nullable: true,
              example: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
            },
          },
        },
        PaginatedAccounts: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/Account" },
            },
            pagination: { $ref: "#/components/schemas/Pagination" },
          },
        },
        PaginatedCategories: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/Category" },
            },
            pagination: { $ref: "#/components/schemas/Pagination" },
          },
        },
        PaginatedTransactions: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/Transaction" },
            },
            pagination: { $ref: "#/components/schemas/Pagination" },
          },
        },
        Transaction: {
          type: "object",
          properties: {
            id: {
              type: "string",
              format: "uuid",
              example: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
            },
            type: {
              type: "string",
              enum: ["INCOME", "EXPENSE", "TRANSFER"],
              example: "EXPENSE",
            },
            amount: { type: "number", example: 50.0 },
            date: {
              type: "string",
              format: "date-time",
              example: "2026-03-28T12:00:00.000Z",
            },
            categoryId: {
              type: "string",
              format: "uuid",
              nullable: true,
              example: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
            },
            description: {
              type: "string",
              nullable: true,
              example: "Grocery shopping",
            },
            fromAccountId: {
              type: "string",
              format: "uuid",
              nullable: true,
              example: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
            },
            toAccountId: {
              type: "string",
              format: "uuid",
              nullable: true,
              example: null,
            },
            userId: {
              type: "string",
              format: "uuid",
              example: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
            },
            tags: {
              type: "string",
              nullable: true,
              example: "groceries,food",
            },
            note: {
              type: "string",
              nullable: true,
              example: "Weekly grocery run",
            },
            createdAt: {
              type: "string",
              format: "date-time",
              example: "2026-03-28T12:00:00.000Z",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
              example: "2026-03-28T12:00:00.000Z",
            },
          },
        },
        CreateTransaction: {
          type: "object",
          required: ["type", "amount", "date"],
          properties: {
            type: {
              type: "string",
              enum: ["INCOME", "EXPENSE", "TRANSFER"],
            },
            amount: { type: "number", minimum: 0, exclusiveMinimum: true },
            date: { type: "string", format: "date-time" },
            categoryId: { type: "string", format: "uuid", nullable: true },
            description: { type: "string", maxLength: 255, nullable: true },
            fromAccountId: { type: "string", format: "uuid", nullable: true },
            toAccountId: { type: "string", format: "uuid", nullable: true },
            tags: { type: "string", maxLength: 500, nullable: true },
            note: { type: "string", maxLength: 1000, nullable: true },
          },
        },
        UpdateTransaction: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["INCOME", "EXPENSE", "TRANSFER"],
            },
            amount: { type: "number", minimum: 0, exclusiveMinimum: true },
            date: { type: "string", format: "date-time" },
            categoryId: { type: "string", format: "uuid", nullable: true },
            description: { type: "string", maxLength: 255, nullable: true },
            fromAccountId: { type: "string", format: "uuid", nullable: true },
            toAccountId: { type: "string", format: "uuid", nullable: true },
            tags: { type: "string", maxLength: 500, nullable: true },
            note: { type: "string", maxLength: 1000, nullable: true },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ["./src/app/routes/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
