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

// The address as the client has it, for a service that must see it whole (Turnstile's remoteip).
export const clientAddress = (req: Request): string => {
  const forwarded = req.gatewayTrusted
    ? req.headers[CLIENT_IP_HEADER]
    : undefined;
  const candidate = typeof forwarded === "string" ? forwarded.trim() : "";
  return isIP(candidate) ? candidate : (req.ip ?? "");
};

// ipKeyGenerator collapses an IPv6 address to its /56, so a client cannot rotate inside its own subnet.
export const clientIp = (req: Request): string =>
  ipKeyGenerator(clientAddress(req));
