import { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { validate } from "../../app/validation/validate";

const createMockReqResNext = (
  data: { body?: unknown; query?: unknown; params?: unknown } = {},
): {
  req: Request;
  res: jest.Mocked<Response>;
  next: jest.MockedFunction<NextFunction>;
} => {
  const req = {
    body: data.body ?? {},
    query: data.query ?? {},
    params: data.params ?? {},
  } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Response>;
  const next = jest.fn() as jest.MockedFunction<NextFunction>;
  return { req, res, next };
};

const testSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    age: z.number().int().positive(),
  }),
});

describe("validate middleware", () => {
  it("should call next() when validation passes", () => {
    const middleware = validate(testSchema);
    const { req, res, next } = createMockReqResNext({
      body: { name: "John", age: 30 },
    });

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should return 400 with ValidationError on validation failure", () => {
    const middleware = validate(testSchema);
    const { req, res, next } = createMockReqResNext({
      body: { name: "", age: -1 },
    });

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "ValidationError",
        message: "Invalid request data",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should include field-level details for each validation issue", () => {
    const middleware = validate(testSchema);
    const { req, res, next } = createMockReqResNext({
      body: {},
    });

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall.details).toBeInstanceOf(Array);
    expect(jsonCall.details.length).toBeGreaterThanOrEqual(1);
    for (const detail of jsonCall.details) {
      expect(detail).toHaveProperty("field");
      expect(detail).toHaveProperty("message");
    }
  });

  it("should aggregate multiple validation errors", () => {
    const multiFieldSchema = z.object({
      body: z.object({
        email: z.string().email(),
        password: z.string().min(8),
      }),
    });
    const middleware = validate(multiFieldSchema);
    const { req, res, next } = createMockReqResNext({
      body: { email: "invalid", password: "short" },
    });

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall.details.length).toBe(2);
  });

  it("should call next(error) for non-Zod errors", () => {
    const throwingSchema = {
      parse: () => {
        throw new Error("Unexpected error");
      },
    } as unknown as z.ZodType;

    const middleware = validate(throwingSchema);
    const { req, res, next } = createMockReqResNext();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should work with schemas that use refine()", () => {
    const refinedSchema = z.object({
      body: z
        .object({
          name: z.string().optional(),
        })
        .refine((data) => data.name !== undefined, {
          message: "Name is required",
        }),
    });
    const middleware = validate(refinedSchema);
    const { req, res, next } = createMockReqResNext({
      body: {},
    });

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
