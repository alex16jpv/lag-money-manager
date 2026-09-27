export type CaptchaAction = "forgot-password" | "register" | "verify-email";

export type CaptchaVerdict =
  | { passed: true }
  | { passed: false; reason: "refused" | "unavailable"; detail: string };

export interface CaptchaCheck {
  token: string;
  remoteIp: string;
  action: CaptchaAction;
}

export interface CaptchaVerifier {
  verify(check: CaptchaCheck): Promise<CaptchaVerdict>;
}
