import { Request } from "express";

import { CLIENT_IP_HEADER } from "../../app/middlewares/clientIp";
import { rateLimitKey } from "../../app/middlewares/rateLimitKey";

const req = (over: Partial<Request>): Request =>
  ({ headers: {}, ...over }) as Request;

const throughGateway = (ip: string, clientIp: string): Request =>
  req({
    ip,
    gatewayTrusted: true,
    headers: { [CLIENT_IP_HEADER]: clientIp },
  } as Partial<Request>);

describe("rateLimitKey", () => {
  it("counts an authenticated request against its user", () => {
    expect(
      rateLimitKey(
        req({ user: { userId: "u1", email: "a@b.c" }, ip: "10.0.0.1" }),
      ),
    ).toBe("u1");
  });

  // The whole point: the web client's requests all arrive from one address.
  it("gives two users behind the same address separate budgets", () => {
    const ip = "10.0.0.1";
    expect(
      rateLimitKey(req({ user: { userId: "u1", email: "a@b.c" }, ip })),
    ).not.toBe(
      rateLimitKey(req({ user: { userId: "u2", email: "d@e.f" }, ip })),
    );
  });

  it("falls back to the address where there is no session", () => {
    expect(rateLimitKey(req({ ip: "10.0.0.1" }))).toBe("10.0.0.1");
  });

  it("does not throw when the address is unknown", () => {
    expect(() => rateLimitKey(req({}))).not.toThrow();
  });

  it("separates two sessionless clients that reach the API from the same frontend server", () => {
    const frontend = "76.76.21.21";
    expect(rateLimitKey(throughGateway(frontend, "203.0.113.7"))).toBe(
      "203.0.113.7",
    );
    expect(rateLimitKey(throughGateway(frontend, "203.0.113.7"))).not.toBe(
      rateLimitKey(throughGateway(frontend, "198.51.100.4")),
    );
  });
});
