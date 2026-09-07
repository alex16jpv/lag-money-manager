import { Request } from "express";

import { ApiError } from "../../shared/errors";
import { ifMatchHeader } from "../validation/schemas";

/**
 * The version the client is writing against: the `updatedAt` it last read,
 * verbatim from the API. Absent header = no guard, today's behaviour.
 */
export function ifMatch(req: Request): Date | undefined {
  const raw = req.get("If-Match");
  if (raw === undefined) return undefined;
  const parsed = ifMatchHeader.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      "BadRequest",
      "Invalid request data",
      "VALIDATION",
      parsed.error.issues.map((issue) => ({
        field: "If-Match",
        message: issue.message,
      })),
    );
  }
  return new Date(parsed.data);
}
