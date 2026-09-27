import { CaptchaVerifier } from "../../domain/captcha/CaptchaVerifier";
import { TurnstileVerifier } from "../../infrastructure/captcha/TurnstileVerifier";
import { ENVIRONMENT } from "../../shared/constants";

export function createCaptchaVerifier(): CaptchaVerifier {
  return new TurnstileVerifier(
    ENVIRONMENT.TURNSTILE_SECRET,
    new URL(ENVIRONMENT.APP_URL).hostname,
  );
}
