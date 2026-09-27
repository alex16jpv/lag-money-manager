jest.mock("../../shared/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { Request, Response } from "express";

import {
  captchaIfSent,
  requireCaptcha,
} from "../../app/middlewares/captchaMiddleware";
import { CaptchaVerifier } from "../../domain/captcha/CaptchaVerifier";
import logger from "../../shared/logger";

const request = (overrides: Partial<Request> = {}): Request =>
  ({
    body: { captcha: "token" },
    headers: { "x-client-ip": "198.51.100.4" },
    gatewayTrusted: true,
    ip: "10.0.0.1",
    ...overrides,
  }) as unknown as Request;

const verifier = (
  verdict: Awaited<ReturnType<CaptchaVerifier["verify"]>>,
): jest.Mocked<CaptchaVerifier> => ({
  verify: jest.fn().mockResolvedValue(verdict),
});

describe("requireCaptcha", () => {
  it("lets a passed check through, checked for its action and the client's own address", async () => {
    const passing = verifier({ passed: true });
    const next = jest.fn();

    await requireCaptcha("forgot-password", passing)(
      request(),
      {} as Response,
      next,
    );

    expect(next).toHaveBeenCalledWith();
    expect(passing.verify).toHaveBeenCalledWith({
      token: "token",
      remoteIp: "198.51.100.4",
      action: "forgot-password",
    });
  });

  it("answers a refused token 400 CAPTCHA_INVALID", async () => {
    const next = jest.fn();
    await expect(
      requireCaptcha(
        "forgot-password",
        verifier({
          passed: false,
          reason: "refused",
          detail: "timeout-or-duplicate",
        }),
      )(request(), {} as Response, next),
    ).rejects.toMatchObject({ statusCode: 400, code: "CAPTCHA_INVALID" });
    expect(next).not.toHaveBeenCalled();
  });

  it("answers 503 CAPTCHA_UNAVAILABLE when the check could not run, and logs it", async () => {
    await expect(
      requireCaptcha(
        "forgot-password",
        verifier({
          passed: false,
          reason: "unavailable",
          detail: "TURNSTILE_SECRET is not set",
        }),
      )(request(), {} as Response, jest.fn()),
    ).rejects.toMatchObject({ statusCode: 503, code: "CAPTCHA_UNAVAILABLE" });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "CAPTCHA_UNAVAILABLE",
        detail: "TURNSTILE_SECRET is not set",
      }),
      expect.any(String),
    );
  });
});

describe("captchaIfSent [T-209]", () => {
  it("lets a request with no token through unchecked, and unmarked", async () => {
    const passing = verifier({ passed: true });
    const req = request({ body: {} });
    const next = jest.fn();

    await captchaIfSent("register", passing)(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(passing.verify).not.toHaveBeenCalled();
    expect(req.captchaPassed).toBeUndefined();
  });

  it("marks a request whose token passed, checked for its action", async () => {
    const passing = verifier({ passed: true });
    const req = request();

    await captchaIfSent("register", passing)(req, {} as Response, jest.fn());

    expect(req.captchaPassed).toBe(true);
    expect(passing.verify).toHaveBeenCalledWith(
      expect.objectContaining({ token: "token", action: "register" }),
    );
  });

  it("refuses a token sent and refused, as requireCaptcha does", async () => {
    const next = jest.fn();
    await expect(
      captchaIfSent(
        "register",
        verifier({
          passed: false,
          reason: "refused",
          detail: "invalid-input-response",
        }),
      )(request(), {} as Response, next),
    ).rejects.toMatchObject({ statusCode: 400, code: "CAPTCHA_INVALID" });
    expect(next).not.toHaveBeenCalled();
  });

  it("fails closed when a token was sent and could not be checked", async () => {
    await expect(
      captchaIfSent(
        "register",
        verifier({ passed: false, reason: "unavailable", detail: "timeout" }),
      )(request(), {} as Response, jest.fn()),
    ).rejects.toMatchObject({ statusCode: 503, code: "CAPTCHA_UNAVAILABLE" });
  });
});
