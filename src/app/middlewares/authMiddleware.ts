import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { ENVIRONMENT } from "../../shared/constants";
import { ApiError } from "../../shared/errors";

export interface AuthPayload {
  userId: number;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export const authMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(
      "Unauthorized",
      "Missing or invalid authorization header",
    );
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, ENVIRONMENT.JWT_SECRET) as AuthPayload;
    req.user = decoded;
    next();
  } catch {
    throw new ApiError("Unauthorized", "Invalid or expired token");
  }
};
