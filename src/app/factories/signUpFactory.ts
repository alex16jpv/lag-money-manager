import { ENVIRONMENT } from "../../shared/constants";
import { AuthService } from "../services/AuthService";
import { FORGOT_FLOOR_MARGIN_MS } from "../services/PasswordResetService";
import { SignUpService } from "../services/SignUpService";
import { createEmailService } from "./emailServiceFactory";
import repositoryFactory from "./RepositoryFactory";

export function createSignUpService(auth: AuthService): SignUpService {
  return new SignUpService(
    repositoryFactory.getUserRepository(),
    repositoryFactory.getSignUpRepository(),
    repositoryFactory.getAuthCodeRepository(),
    createEmailService(),
    auth,
    {
      resendAfterSeconds: ENVIRONMENT.EMAIL_ADDRESS_INTERVAL_SECONDS,
      floorMarginMs: FORGOT_FLOOR_MARGIN_MS,
    },
  );
}
