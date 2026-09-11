import { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import { isIP } from "net";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- module augmentation of Express types requires a namespace
  namespace Express {
    interface Request {
      gatewayTrusted?: boolean;
    }
  }
}

export const CLIENT_IP_HEADER = "x-client-ip";

export const clientIp = (req: Request): string => {
  const forwarded = req.gatewayTrusted
    ? req.headers[CLIENT_IP_HEADER]
    : undefined;
  const candidate = typeof forwarded === "string" ? forwarded.trim() : "";
  // ipKeyGenerator collapses an IPv6 address to its /56, so a client cannot rotate inside its own subnet.
  return ipKeyGenerator(isIP(candidate) ? candidate : (req.ip ?? ""));
};
