import { NextFunction, Request, Response } from "express";
import { DB_TYPES, ENVIRONMENT } from "../../shared/constants";
import { connectMongo } from "../../config/mongoConnection";

/**
 * With mongoose command buffering disabled, queries fail immediately while
 * disconnected — so make sure the connection is up (or being retried) before
 * the request reaches a repository. Connection failures land in the error
 * middleware as a 503. Sequelize manages its own pool per query, so SEQ
 * requests pass straight through.
 */
export const dbReadinessMiddleware = async (
  _req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  if (ENVIRONMENT.DB_TYPE === DB_TYPES.MONGO) {
    await connectMongo();
  }
  next();
};
