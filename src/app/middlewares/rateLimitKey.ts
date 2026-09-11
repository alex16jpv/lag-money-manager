import { Request } from "express";

import { clientIp } from "./clientIp";

// Per user once authenticated; never req.ip, which for the web client is the frontend server shared by everyone.
export const rateLimitKey = (req: Request): string =>
  req.user?.userId ?? clientIp(req);
