import {
  HttpPost,
  TurnstileVerifier,
} from "../../infrastructure/captcha/TurnstileVerifier";

const SECRET = "0x4AAAAAAAexample-production-secret";
const TEST_SECRET = "1x0000000000000000000000000000000AA";
const HOST = "ledgerflow.alexpiral.com";
const CHECK = {
  token: "token-from-the-widget",
  remoteIp: "2001:db8::1",
  action: "forgot-password" as const,
};

const answering = (
  status: number,
  body: unknown,
): jest.MockedFunction<HttpPost> =>
  jest.fn<ReturnType<HttpPost>, Parameters<HttpPost>>(async () => ({
    status,
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));

const passed = { success: true, hostname: HOST, action: "forgot-password" };

describe("TurnstileVerifier", () => {
  it("sends the secret, the token and the whole client address as JSON", async () => {
    const post = answering(200, passed);

    await expect(
      new TurnstileVerifier(SECRET, HOST, post).verify(CHECK),
    ).resolves.toEqual({ passed: true });
    const [url, body] = post.mock.calls[0];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(JSON.parse(body)).toEqual({
      secret: SECRET,
      response: "token-from-the-widget",
      remoteip: "2001:db8::1",
    });
  });

  it("leaves the address out when there is none", async () => {
    const post = answering(200, passed);
    await new TurnstileVerifier(SECRET, HOST, post).verify({
      ...CHECK,
      remoteIp: "",
    });
    expect(JSON.parse(post.mock.calls[0][1])).not.toHaveProperty("remoteip");
  });

  it.each([
    ["a spent or expired token", ["timeout-or-duplicate"]],
    ["a forged token", ["invalid-input-response"]],
  ])("refuses %s", async (_label, codes) => {
    const verdict = await new TurnstileVerifier(
      SECRET,
      HOST,
      answering(200, { success: false, "error-codes": codes }),
    ).verify(CHECK);
    expect(verdict).toMatchObject({ passed: false, reason: "refused" });
  });

  it("refuses a token issued on another site or for another action", async () => {
    const onOtherSite = await new TurnstileVerifier(
      SECRET,
      HOST,
      answering(200, { ...passed, hostname: "evil.example" }),
    ).verify(CHECK);
    const forOtherAction = await new TurnstileVerifier(
      SECRET,
      HOST,
      answering(200, { ...passed, action: "register" }),
    ).verify(CHECK);
    expect(onOtherSite).toMatchObject({ passed: false, reason: "refused" });
    expect(forOtherAction).toMatchObject({ passed: false, reason: "refused" });
  });

  it("does not hold a test secret's own hostname and action against it", async () => {
    await expect(
      new TurnstileVerifier(
        TEST_SECRET,
        "localhost",
        answering(200, {
          success: true,
          hostname: "example.com",
          action: "test",
        }),
      ).verify(CHECK),
    ).resolves.toEqual({ passed: true });
  });

  it.each([
    ["no secret is set", undefined, answering(200, passed)],
    [
      "Cloudflare does not answer",
      SECRET,
      jest.fn<ReturnType<HttpPost>, Parameters<HttpPost>>(async () => {
        throw new Error("The operation was aborted due to timeout");
      }),
    ],
    ["Cloudflare answers 5xx", SECRET, answering(502, "Bad gateway")],
    [
      "Cloudflare answers what is not its JSON",
      SECRET,
      answering(200, "<html>"),
    ],
    [
      "Cloudflare says it could not judge",
      SECRET,
      answering(200, { success: false, "error-codes": ["internal-error"] }),
    ],
    [
      "our secret is wrong",
      SECRET,
      answering(200, {
        success: false,
        "error-codes": ["invalid-input-secret"],
      }),
    ],
  ])("is unavailable, not refused, when %s", async (_label, secret, post) => {
    const verdict = await new TurnstileVerifier(secret, HOST, post).verify(
      CHECK,
    );
    expect(verdict).toMatchObject({ passed: false, reason: "unavailable" });
  });
});
