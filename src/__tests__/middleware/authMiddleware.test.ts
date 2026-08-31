jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    JWT_SECRET: "test-secret-key",
  },
}));

import { NextFunction,Request, Response } from "express";
import jwt from "jsonwebtoken";

import { authMiddleware } from "../../app/middlewares/authMiddleware";
import { ApiError } from "../../shared/errors";

const createMockReqResNext = (
  authHeader?: string,
): {
  req: Request;
  res: jest.Mocked<Response>;
  next: jest.MockedFunction<NextFunction>;
} => {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers.authorization = authHeader;
  }
  const req = { headers } as unknown as Request;
  const res = {} as jest.Mocked<Response>;
  const next = jest.fn() as jest.MockedFunction<NextFunction>;
  return { req, res, next };
};

const validPayload = {
  userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
  email: "john@example.com",
};

const createValidToken = (
  payload: object = validPayload,
  expiresIn: string = "1h",
): string =>
  jwt.sign(payload, "test-secret-key", {
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
  });

describe("authMiddleware", () => {
  describe("missing or malformed authorization header", () => {
    it("should throw Unauthorized when no authorization header is present", () => {
      const { req, res, next } = createMockReqResNext();

      expect(() => authMiddleware(req, res, next)).toThrow(ApiError);
      expect(() => authMiddleware(req, res, next)).toThrow(
        "Missing or invalid authorization header",
      );
    });

    it("should throw Unauthorized when authorization header is empty", () => {
      const { req, res, next } = createMockReqResNext("");

      expect(() => authMiddleware(req, res, next)).toThrow(ApiError);
      expect(() => authMiddleware(req, res, next)).toThrow(
        "Missing or invalid authorization header",
      );
    });

    it("should throw Unauthorized when authorization header does not start with Bearer", () => {
      const { req, res, next } = createMockReqResNext("Basic abc123");

      expect(() => authMiddleware(req, res, next)).toThrow(ApiError);
      expect(() => authMiddleware(req, res, next)).toThrow(
        "Missing or invalid authorization header",
      );
    });

    it("should throw Unauthorized when Bearer prefix has no token", () => {
      const { req, res, next } = createMockReqResNext("Bearer ");

      expect(() => authMiddleware(req, res, next)).toThrow(
        "Invalid or expired token",
      );
    });
  });

  describe("valid token", () => {
    it("should call next() and set req.user with valid token", () => {
      const token = createValidToken();
      const { req, res, next } = createMockReqResNext(`Bearer ${token}`);

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBeDefined();
      expect(req.user!.userId).toBe(validPayload.userId);
      expect(req.user!.email).toBe(validPayload.email);
    });
  });

  describe("invalid tokens", () => {
    it("should throw Unauthorized for expired token", () => {
      const token = jwt.sign(validPayload, "test-secret-key", {
        expiresIn: "0s",
      });

      const { req, res, next } = createMockReqResNext(`Bearer ${token}`);

      expect(() => authMiddleware(req, res, next)).toThrow(ApiError);
      expect(() => authMiddleware(req, res, next)).toThrow(
        "Invalid or expired token",
      );
    });

    it("should throw Unauthorized for token signed with wrong secret", () => {
      const token = jwt.sign(validPayload, "wrong-secret-key", {
        expiresIn: "1h",
      });

      const { req, res, next } = createMockReqResNext(`Bearer ${token}`);

      expect(() => authMiddleware(req, res, next)).toThrow(ApiError);
      expect(() => authMiddleware(req, res, next)).toThrow(
        "Invalid or expired token",
      );
    });

    it("should throw Unauthorized for malformed token string", () => {
      const { req, res, next } = createMockReqResNext("Bearer not.a.valid.jwt");

      expect(() => authMiddleware(req, res, next)).toThrow(ApiError);
      expect(() => authMiddleware(req, res, next)).toThrow(
        "Invalid or expired token",
      );
    });

    it("should throw Unauthorized for token with empty signature", () => {
      const header = Buffer.from(
        JSON.stringify({ alg: "HS256", typ: "JWT" }),
      ).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          email: "john@example.com",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString("base64url");
      const tokenWithoutSignature = `${header}.${payload}.`;

      const { req, res, next } = createMockReqResNext(
        `Bearer ${tokenWithoutSignature}`,
      );

      expect(() => authMiddleware(req, res, next)).toThrow(ApiError);
      expect(() => authMiddleware(req, res, next)).toThrow(
        "Invalid or expired token",
      );
    });

    it("should throw Unauthorized for token using 'none' algorithm", () => {
      const header = Buffer.from(
        JSON.stringify({ alg: "none", typ: "JWT" }),
      ).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          email: "john@example.com",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString("base64url");
      const noneAlgToken = `${header}.${payload}.`;

      const { req, res, next } = createMockReqResNext(
        `Bearer ${noneAlgToken}`,
      );

      expect(() => authMiddleware(req, res, next)).toThrow(ApiError);
      expect(() => authMiddleware(req, res, next)).toThrow(
        "Invalid or expired token",
      );
    });

    it("should throw Unauthorized for token with valid signature but invalid payload shape", () => {
      const token = jwt.sign(
        { foo: "bar", baz: 123 },
        "test-secret-key",
        { algorithm: "HS256", expiresIn: "1h" },
      );

      const { req, res, next } = createMockReqResNext(`Bearer ${token}`);

      expect(() => authMiddleware(req, res, next)).toThrow(ApiError);
      expect(() => authMiddleware(req, res, next)).toThrow(
        "Invalid token payload",
      );
    });
  });
});
