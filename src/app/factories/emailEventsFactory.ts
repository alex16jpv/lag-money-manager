import { ISnsInbox } from "../../domain/email/SnsInbox";
import { SnsInbox } from "../../infrastructure/email/SnsInbox";
import { ENVIRONMENT } from "../../shared/constants";
import { EmailEventService } from "../services/EmailEventService";
import repositoryFactory from "./RepositoryFactory";

export function createSesInbox(): ISnsInbox {
  return new SnsInbox(ENVIRONMENT.EMAIL_SES_EVENTS_TOPIC_ARN);
}

export function createEmailEventService(): EmailEventService {
  return new EmailEventService(
    repositoryFactory.getEmailDeliveryRepository(),
    repositoryFactory.getEmailSuppressionRepository(),
  );
}
