import { Request } from "express";

import { DEFAULT_TIMEZONE } from "../../shared/timezone";
import repositoryFactory from "../factories/RepositoryFactory";

const userRepository = repositoryFactory.getUserRepository();

/**
 * The account's timezone: it cuts the days and the budget periods, and it
 * freezes the accounting day of every transaction written.
 */
export async function resolveTimezone(req: Request): Promise<string> {
  // Token claim first (R2-23); DB fallback covers tokens minted before it.
  return (
    req.user!.timezone ??
    (await userRepository.getById(req.user!.userId))?.timezone ??
    DEFAULT_TIMEZONE
  );
}
