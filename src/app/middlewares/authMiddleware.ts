import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { ENVIRONMENT } from "../../shared/constants";
import { ApiError } from "../../shared/errors";

export interface AuthPayload {
  userId: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

const isAuthPayload = (payload: unknown): payload is AuthPayload =>
  typeof payload === "object" &&
  payload !== null &&
  typeof (payload as AuthPayload).userId === "string" &&
  typeof (payload as AuthPayload).email === "string";

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
    const decoded = jwt.verify(token, ENVIRONMENT.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    if (!isAuthPayload(decoded)) {
      throw new ApiError("Unauthorized", "Invalid token payload");
    }

    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("Unauthorized", "Invalid or expired token");
  }
};
