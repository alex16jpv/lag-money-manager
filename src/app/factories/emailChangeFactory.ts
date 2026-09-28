import { ENVIRONMENT } from "../../shared/constants";
import { AuthService } from "../services/AuthService";
import { EmailChangeService } from "../services/EmailChangeService";
import { createEmailService } from "./emailServiceFactory";
import repositoryFactory from "./RepositoryFactory";

export function createEmailChangeService(
  auth: AuthService,
): EmailChangeService {
  return new EmailChangeService(
    repositoryFactory.getUserRepository(),
    repositoryFactory.getAuthCodeRepository(),
    createEmailService(),
    repositoryFactory.getSharedInvitationRepository(),
    repositoryFactory.getRefreshSessionRepository(),
    auth,
    { resendAfterSeconds: ENVIRONMENT.EMAIL_ADDRESS_INTERVAL_SECONDS },
  );
}
