import { z } from "zod";

import {
  CaptchaCheck,
  CaptchaVerdict,
  CaptchaVerifier,
} from "../../domain/captcha/CaptchaVerifier";
import { TURNSTILE_TEST_SECRET } from "../../shared/constants";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const HTTP_TIMEOUT_MS = 3000;

// Codes that say the token was never judged: our request or Cloudflare failed, not the person.
const UNJUDGED = new Set([
  "missing-input-secret",
  "invalid-input-secret",
  "bad-request",
  "internal-error",
]);

const siteverifySchema = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).default([]),
  hostname: z.string().optional(),
  action: z.string().optional(),
});

export type HttpPost = (
  url: string,
  body: string,
) => Promise<{ status: number; body: string }>;

const httpPost: HttpPost = async (url, body) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  return { status: response.status, body: await response.text() };
};

const unavailable = (detail: string): CaptchaVerdict => ({
  passed: false,
  reason: "unavailable",
  detail,
});

const refused = (detail: string): CaptchaVerdict => ({
  passed: false,
  reason: "refused",
  detail,
});

export class TurnstileVerifier implements CaptchaVerifier {
  constructor(
    private readonly secret: string | undefined,
    private readonly hostname: string,
    private readonly post: HttpPost = httpPost,
  ) {}

  async verify({
    token,
    remoteIp,
    action,
  }: CaptchaCheck): Promise<CaptchaVerdict> {
    if (!this.secret) return unavailable("TURNSTILE_SECRET is not set");

    let answer: { status: number; body: string };
    try {
      answer = await this.post(
        SITEVERIFY_URL,
        JSON.stringify({
          secret: this.secret,
          response: token,
          ...(remoteIp && { remoteip: remoteIp }),
        }),
      );
    } catch (err) {
      return unavailable(
        `siteverify did not answer: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (answer.status !== 200) {
      return unavailable(`siteverify answered HTTP ${answer.status}`);
    }

    let parsed: z.infer<typeof siteverifySchema>;
    try {
      parsed = siteverifySchema.parse(JSON.parse(answer.body));
    } catch {
      return unavailable("siteverify answered something that is not its JSON");
    }

    const codes = parsed["error-codes"];
    if (!parsed.success) {
      return codes.some((code) => UNJUDGED.has(code))
        ? unavailable(
            `siteverify could not judge the token: ${codes.join(", ")}`,
          )
        : refused(
            `siteverify refused the token: ${codes.join(", ") || "no reason"}`,
          );
    }
    // A test secret answers its own hostname and action, and production refuses one at startup.
    if (TURNSTILE_TEST_SECRET.test(this.secret)) return { passed: true };
    if (parsed.hostname !== this.hostname) {
      return refused(
        `the token was issued on ${parsed.hostname ?? "no hostname"}`,
      );
    }
    if (parsed.action !== action) {
      return refused(
        `the token was issued for ${parsed.action ?? "no action"}`,
      );
    }
    return { passed: true };
  }
}
