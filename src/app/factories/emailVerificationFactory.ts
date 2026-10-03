import { ENVIRONMENT } from "../../shared/constants";
import { AuthService } from "../services/AuthService";
import { EmailVerificationService } from "../services/EmailVerificationService";
import { createEmailService } from "./emailServiceFactory";
import repositoryFactory from "./RepositoryFactory";
import { createSignUpService } from "./signUpFactory";

export function createEmailVerificationService(
  auth: AuthService,
): EmailVerificationService {
  return new EmailVerificationService(
    repositoryFactory.getUserRepository(),
    repositoryFactory.getAuthCodeRepository(),
    createEmailService(),
    repositoryFactory.getSharedInvitationRepository(),
    createSignUpService(auth),
    { resendAfterSeconds: ENVIRONMENT.EMAIL_ADDRESS_INTERVAL_SECONDS },
  );
}
