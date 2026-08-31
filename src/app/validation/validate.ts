import { NextFunction, Request, Response } from "express";
import { z } from "zod";

interface ParsedRequest {
  body?: unknown;
  params?: unknown;
  query?: unknown;
}

export const validate =
  (schema: z.ZodType) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      }) as ParsedRequest;

      // Replace the raw request payloads with the parsed (and therefore
      // whitelisted) values. Zod strips keys not declared in the schema, so
      // this is what prevents mass assignment: fields like `balance` or
      // `userId` that no schema declares never reach the services or the ORM.
      // Note: `req.query` is a read-only getter in Express 5 and cannot be
      // reassigned; controllers read individual query fields explicitly, so
      // there is no mass-assignment path through the query string.
      if (parsed.body !== undefined) {
        req.body = parsed.body;
      }
      if (parsed.params !== undefined) {
        req.params = parsed.params as Request["params"];
      }

      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));

        _res.status(400).json({
          error: "ValidationError",
          message: "Invalid request data",
          details,
        });
        return;
      }
      next(error);
    }
  };
