import { EventEmitter } from "events";
import { Request, Response } from "express";

import { requestLogMiddleware } from "../../app/middlewares/requestLogMiddleware";
import logger from "../../shared/logger";

jest.mock("../../shared/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

const log = logger as unknown as Record<
  "info" | "warn" | "error" | "debug",
  jest.Mock
>;

interface MockRes extends EventEmitter {
  statusCode: number;
  locals: Record<string, unknown>;
}

const makeReq = (over: Partial<Request> = {}): Request =>
  ({
    method: "GET",
    path: "/accounts",
    originalUrl: "/accounts?limit=5",
    headers: { "x-request-id": "req-1" },
    ...over,
  }) as unknown as Request;

const makeRes = (statusCode = 200): MockRes => {
  const res = new EventEmitter() as MockRes;
  res.statusCode = statusCode;
  res.locals = {};
  return res;
};

const run = (req: Request, res: MockRes): void => {
  const next = jest.fn();
  requestLogMiddleware(req, res as unknown as Response, next);
  expect(next).toHaveBeenCalled();
  res.emit("finish");
};

describe("requestLogMiddleware", () => {
  beforeEach(() => jest.clearAllMocks());

  it("logs successful requests at info with method, path, status and requestId", () => {
    run(makeReq(), makeRes(200));

    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/accounts?limit=5",
        status: 200,
        requestId: "req-1",
      }),
      "request completed",
    );
  });

  it("logs 4xx at warn including the error code and message from res.locals", () => {
    const res = makeRes(403);
    res.locals.errorCode = "FORBIDDEN";
    res.locals.errorMessage = "Access denied";
    run(makeReq(), res);

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 403,
        code: "FORBIDDEN",
        errorMessage: "Access denied",
      }),
      "request rejected",
    );
    expect(log.info).not.toHaveBeenCalled();
  });

  it("logs 5xx at error", () => {
    run(makeReq(), makeRes(500));
    expect(log.error).toHaveBeenCalled();
  });

  it("includes userId for authenticated requests", () => {
    run(
      makeReq({ user: { userId: "u1", email: "a@b.c" } } as Partial<Request>),
      makeRes(200),
    );
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1" }),
      "request completed",
    );
  });

  it("demotes healthy probe endpoints to debug", () => {
    run(makeReq({ path: "/health/db", originalUrl: "/health/db" }), makeRes());
    expect(log.debug).toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });
});
