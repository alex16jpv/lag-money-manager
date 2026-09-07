import { NextFunction, Request, Response } from "express";

import { authRateLimit } from "../../app/middlewares/authRateLimitMiddleware";
import { RateLimitModel } from "../../infrastructure/models/RateLimitModel";

jest.mock("../../shared/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

jest.mock("../../infrastructure/models/RateLimitModel", () => ({
  RateLimitModel: {
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  },
}));

const model = RateLimitModel as unknown as {
  findOneAndUpdate: jest.Mock;
  updateOne: jest.Mock;
};

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  sentBody: unknown;
  setHeader: (k: string, v: string) => void;
  status: (code: number) => MockRes;
  json: (body?: unknown) => MockRes;
}

const createRes = (): MockRes => {
  const res: MockRes = {
    statusCode: 200,
    headers: {},
    sentBody: undefined,
    setHeader(k, v) {
      res.headers[k] = v;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.sentBody = body;
      return res;
    },
  };
  return res;
};

const req = { ip: "1.2.3.4" } as Request;
const futureWindow = (): Date => new Date(Date.now() + 60_000);

const run = async (
  res: MockRes,
  refundOnSuccess = true,
): Promise<NextFunction> => {
  const next: NextFunction = jest.fn();
  const middleware = authRateLimit({
    keyPrefix: "login",
    max: 10,
    windowMs: 900_000,
    refundOnSuccess,
  });
  await middleware(req, res as unknown as Response, next);
  return next;
};

describe("authRateLimit refund on success", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    model.updateOne.mockReturnValue({ exec: () => Promise.resolve() });
  });

  it("refunds BEFORE the success response is sent (Lambda freezes after replying)", async () => {
    model.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ count: 1, expiresAt: futureWindow() }),
    });
    let refundResolved = false;
    model.updateOne.mockReturnValue({
      exec: () =>
        new Promise<void>((resolve) =>
          setImmediate(() => {
            refundResolved = true;
            resolve();
          }),
        ),
    });
    const res = createRes();
    const next = await run(res);
    expect(next).toHaveBeenCalled();

    res.json({ ok: true });
    expect(res.sentBody).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(refundResolved).toBe(true);
    expect(res.sentBody).toEqual({ ok: true });
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: "login:1.2.3.4", count: { $gt: 0 } },
      { $inc: { count: -1 } },
    );
  });

  it("still sends the response when the refund write fails", async () => {
    model.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ count: 1, expiresAt: futureWindow() }),
    });
    model.updateOne.mockReturnValue({
      exec: () => Promise.reject(new Error("store down")),
    });
    const res = createRes();
    await run(res);

    res.json({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(res.sentBody).toEqual({ ok: true });
  });

  it("does not refund failed attempts", async () => {
    model.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ count: 3, expiresAt: futureWindow() }),
    });
    const res = createRes();
    await run(res);

    res.statusCode = 401;
    res.json({ error: "Unauthorized" });
    expect(res.sentBody).toEqual({ error: "Unauthorized" });
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it("responds 429 over the limit without refunding it", async () => {
    model.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ count: 11, expiresAt: futureWindow() }),
    });
    const res = createRes();
    const next = await run(res);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.sentBody).toMatchObject({ code: "RATE_LIMITED" });
    expect(res.headers["Retry-After"]).toBeDefined();
    expect(model.updateOne).not.toHaveBeenCalled();
  });
});
