import { Request } from "express";

import { CLIENT_IP_HEADER, clientIp } from "../../app/middlewares/clientIp";

const req = (over: {
  ip?: string;
  gatewayTrusted?: boolean;
  header?: string | string[];
}): Request =>
  ({
    ip: over.ip,
    gatewayTrusted: over.gatewayTrusted,
    headers:
      over.header === undefined ? {} : { [CLIENT_IP_HEADER]: over.header },
  }) as unknown as Request;

describe("clientIp", () => {
  it("takes the address the gateway states", () => {
    expect(
      clientIp(
        req({ ip: "76.76.21.21", gatewayTrusted: true, header: "203.0.113.7" }),
      ),
    ).toBe("203.0.113.7");
  });

  it("trims the stated address", () => {
    expect(
      clientIp(
        req({
          ip: "76.76.21.21",
          gatewayTrusted: true,
          header: "  203.0.113.7  ",
        }),
      ),
    ).toBe("203.0.113.7");
  });

  it("ignores the header on a request that did not come through the gateway", () => {
    expect(clientIp(req({ ip: "198.51.100.4", header: "203.0.113.7" }))).toBe(
      "198.51.100.4",
    );
  });

  it("ignores a header that is not an address", () => {
    expect(
      clientIp(
        req({
          ip: "76.76.21.21",
          gatewayTrusted: true,
          header: "not-an-address",
        }),
      ),
    ).toBe("76.76.21.21");
  });

  it("ignores a forwarded list, which is not a single address", () => {
    expect(
      clientIp(
        req({
          ip: "76.76.21.21",
          gatewayTrusted: true,
          header: "203.0.113.7, 76.76.21.21",
        }),
      ),
    ).toBe("76.76.21.21");
  });

  it("ignores a repeated header, which arrives as an array", () => {
    expect(
      clientIp(
        req({
          ip: "76.76.21.21",
          gatewayTrusted: true,
          header: ["203.0.113.7", "198.51.100.4"],
        }),
      ),
    ).toBe("76.76.21.21");
  });

  it("collapses an IPv6 address to its /56 so its subnet cannot be rotated", () => {
    const first = clientIp(
      req({
        gatewayTrusted: true,
        header: "2001:db8:abcd:0012:0000:0000:0000:0001",
      }),
    );
    const second = clientIp(
      req({
        gatewayTrusted: true,
        header: "2001:db8:abcd:0012:ffff:ffff:ffff:ffff",
      }),
    );
    expect(first).toBe(second);
  });

  it("does not throw when there is no address at all", () => {
    expect(() => clientIp(req({}))).not.toThrow();
  });
});
