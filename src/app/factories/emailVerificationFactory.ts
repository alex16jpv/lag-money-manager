import { ENVIRONMENT } from "../../shared/constants";
import { EmailVerificationService } from "../services/EmailVerificationService";
import { createEmailService } from "./emailServiceFactory";
import repositoryFactory from "./RepositoryFactory";

export function createEmailVerificationService(): EmailVerificationService {
  return new EmailVerificationService(
    repositoryFactory.getUserRepository(),
    repositoryFactory.getAuthCodeRepository(),
    createEmailService(),
    repositoryFactory.getSharedInvitationRepository(),
    repositoryFactory.getRefreshSessionRepository(),
    repositoryFactory.getUserDataEraser(),
    { resendAfterSeconds: ENVIRONMENT.EMAIL_ADDRESS_INTERVAL_SECONDS },
  );
}
