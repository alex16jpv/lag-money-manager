import { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";

/**
 * What the general limiter counts against.
 *
 * Per user once authenticated, per IP only where there is no session yet.
 * Every request from the web client reaches the API from the frontend's
 * server, so an IP-keyed budget would be shared by everyone behind it and one
 * active user could lock out the rest. `req.user` is set by authMiddleware,
 * which runs before the limiter on the protected routes, so the id comes from
 * a verified token and cannot be spoofed to widen the budget.
 */
export const rateLimitKey = (req: Request): string =>
  req.user?.userId ?? ipKeyGenerator(req.ip ?? "");
