import jwt from "jsonwebtoken";

import {
  readDeviceToken,
  signDeviceToken,
} from "../../app/services/deviceToken";
import { ENVIRONMENT } from "../../shared/constants";

const EMAIL = "owner@device.test";
const SECRET = ENVIRONMENT.REFRESH_SECRET ?? ENVIRONMENT.JWT_SECRET;
const subjectOf = (token: string): string =>
  (jwt.decode(token) as { sub: string }).sub;

describe("device token", () => {
  it("reads back the device id and the token version it was issued with", () => {
    const token = signDeviceToken(EMAIL, 3);
    const claim = readDeviceToken(token, EMAIL);
    expect(claim).toEqual({ deviceId: expect.any(String), tokenVersion: 3 });
    expect(readDeviceToken(token, EMAIL)).toEqual(claim);
  });

  it("issues a different device id each time", () => {
    expect(
      readDeviceToken(signDeviceToken(EMAIL, 0), EMAIL)?.deviceId,
    ).not.toBe(readDeviceToken(signDeviceToken(EMAIL, 0), EMAIL)?.deviceId);
  });

  it("does not carry the email in clear", () => {
    expect(JSON.stringify(jwt.decode(signDeviceToken(EMAIL, 0)))).not.toContain(
      EMAIL,
    );
  });

  it("does not read a token issued to another email", () => {
    expect(
      readDeviceToken(signDeviceToken("other@device.test", 0), EMAIL),
    ).toBeNull();
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["not a string", 42],
    ["garbage", "not-a-token"],
  ])("does not read a %s token", (_label, token) => {
    expect(readDeviceToken(token, EMAIL)).toBeNull();
  });

  it("does not read a token signed with another secret", () => {
    const forged = jwt.sign({ tokenVersion: 0, jti: "d1" }, "attacker", {
      algorithm: "HS256",
      audience: "device",
      subject: subjectOf(signDeviceToken(EMAIL, 0)),
    });
    expect(readDeviceToken(forged, EMAIL)).toBeNull();
  });

  it("does not read an expired token", () => {
    const expired = jwt.sign(
      { tokenVersion: 0, jti: "d1", exp: Math.floor(Date.now() / 1000) - 1 },
      SECRET,
      {
        algorithm: "HS256",
        audience: "device",
        subject: subjectOf(signDeviceToken(EMAIL, 0)),
      },
    );
    expect(readDeviceToken(expired, EMAIL)).toBeNull();
  });

  it("does not take a refresh or an access token for a device token", () => {
    const subject = subjectOf(signDeviceToken(EMAIL, 0));
    const refresh = jwt.sign(
      { userId: "u1", tokenVersion: 0, type: "refresh", jti: "r1" },
      SECRET,
      { algorithm: "HS256", subject },
    );
    const access = jwt.sign(
      { userId: "u1", email: EMAIL, sid: "s1", tokenVersion: 0, jti: "a1" },
      ENVIRONMENT.JWT_SECRET,
      { algorithm: "HS256", subject },
    );
    expect(readDeviceToken(refresh, EMAIL)).toBeNull();
    expect(readDeviceToken(access, EMAIL)).toBeNull();
  });
});
