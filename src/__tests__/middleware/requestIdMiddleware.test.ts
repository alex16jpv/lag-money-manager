import { NextFunction,Request, Response } from "express";

import { requestIdMiddleware } from "../../shared/requestId";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createMockReqRes = (
  requestId?: string,
): {
  req: Request;
  res: jest.Mocked<Response>;
  next: jest.MockedFunction<NextFunction>;
} => {
  const req = {
    headers: requestId ? { "x-request-id": requestId } : {},
  } as unknown as Request;
  const res = { setHeader: jest.fn() } as unknown as jest.Mocked<Response>;
  const next = jest.fn() as jest.MockedFunction<NextFunction>;
  return { req, res, next };
};

describe("requestIdMiddleware", () => {
  it("should generate a UUID when no x-request-id header is provided", () => {
    const { req, res, next } = createMockReqRes();

    requestIdMiddleware(req, res, next);

    expect(req.headers["x-request-id"]).toMatch(UUID_REGEX);
    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Request-Id",
      req.headers["x-request-id"],
    );
    expect(next).toHaveBeenCalled();
  });

  it("should accept a valid alphanumeric x-request-id", () => {
    const { req, res, next } = createMockReqRes("abc-123_DEF");

    requestIdMiddleware(req, res, next);

    expect(req.headers["x-request-id"]).toBe("abc-123_DEF");
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", "abc-123_DEF");
    expect(next).toHaveBeenCalled();
  });

  it("should accept a valid UUID as x-request-id", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const { req, res, next } = createMockReqRes(id);

    requestIdMiddleware(req, res, next);

    expect(req.headers["x-request-id"]).toBe(id);
    expect(next).toHaveBeenCalled();
  });

  it("should reject x-request-id longer than 64 characters", () => {
    const longId = "a".repeat(65);
    const { req, res, next } = createMockReqRes(longId);

    requestIdMiddleware(req, res, next);

    expect(req.headers["x-request-id"]).not.toBe(longId);
    expect(req.headers["x-request-id"]).toMatch(UUID_REGEX);
    expect(next).toHaveBeenCalled();
  });

  it("should reject x-request-id with special characters", () => {
    const { req, res, next } = createMockReqRes("id<script>alert(1)</script>");

    requestIdMiddleware(req, res, next);

    expect(req.headers["x-request-id"]).toMatch(UUID_REGEX);
    expect(next).toHaveBeenCalled();
  });

  it("should reject x-request-id with spaces", () => {
    const { req, res, next } = createMockReqRes("id with spaces");

    requestIdMiddleware(req, res, next);

    expect(req.headers["x-request-id"]).toMatch(UUID_REGEX);
    expect(next).toHaveBeenCalled();
  });

  it("should reject empty string x-request-id", () => {
    const { req, res, next } = createMockReqRes("");

    requestIdMiddleware(req, res, next);

    expect(req.headers["x-request-id"]).toMatch(UUID_REGEX);
    expect(next).toHaveBeenCalled();
  });

  it("should accept x-request-id at exactly 64 characters", () => {
    const maxId = "a".repeat(64);
    const { req, res, next } = createMockReqRes(maxId);

    requestIdMiddleware(req, res, next);

    expect(req.headers["x-request-id"]).toBe(maxId);
    expect(next).toHaveBeenCalled();
  });
});
