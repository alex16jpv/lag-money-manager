import { NextFunction, Request, Response } from "express";

import { connectMongo } from "../../config/mongoConnection";

/**
 * With mongoose command buffering disabled, queries fail immediately while
 * disconnected — so make sure the connection is up (or being retried) before
 * the request reaches a repository. Connection failures land in the error
 * middleware as a 503.
 */
export const dbReadinessMiddleware = async (
  _req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  await connectMongo();
  next();
};
