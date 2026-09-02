import { Request } from "express";

import { rateLimitKey } from "../../app/middlewares/rateLimitKey";

const req = (over: Partial<Request>): Request => over as Request;

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
});
