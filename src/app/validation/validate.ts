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

      // Use the parsed (whitelisted) values so undeclared fields can't reach
      // services/ORM (mass-assignment guard). req.query is read-only in Express 5.
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
          code: "VALIDATION",
          details,
        });
        return;
      }
      next(error);
    }
  };
