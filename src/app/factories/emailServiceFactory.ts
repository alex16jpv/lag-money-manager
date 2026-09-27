import { createEmailProviders } from "../../infrastructure/email/emailProviders";
import { ENVIRONMENT } from "../../shared/constants";
import { EmailService, EmailServiceConfig } from "../services/EmailService";
import repositoryFactory from "./RepositoryFactory";

export function emailServiceConfig(): EmailServiceConfig {
  return {
    enabled: ENVIRONMENT.EMAIL_SENDING_ENABLED,
    from: {
      name: ENVIRONMENT.EMAIL_FROM_NAME,
      address: ENVIRONMENT.EMAIL_FROM_ADDRESS,
    },
    replyTo: ENVIRONMENT.EMAIL_REPLY_TO,
    appUrl: ENVIRONMENT.APP_URL,
    providerTimeoutMs: ENVIRONMENT.EMAIL_PROVIDER_TIMEOUT_MS,
    caps: {
      daily: ENVIRONMENT.EMAIL_DAILY_CAP,
      monthly: ENVIRONMENT.EMAIL_MONTHLY_CAP,
      resetPercent: ENVIRONMENT.EMAIL_RESET_SHARE_PERCENT,
      otherPercent: ENVIRONMENT.EMAIL_OTHER_SHARE_PERCENT,
    },
    brakes: {
      addressIntervalSeconds: ENVIRONMENT.EMAIL_ADDRESS_INTERVAL_SECONDS,
      addressDailyMax: ENVIRONMENT.EMAIL_ADDRESS_DAILY_MAX,
      userDailyMax: ENVIRONMENT.EMAIL_USER_DAILY_MAX,
      deviceHourlyMax: ENVIRONMENT.EMAIL_DEVICE_HOURLY_MAX,
      ipHourlyMax: ENVIRONMENT.EMAIL_IP_HOURLY_MAX,
    },
  };
}

export function createEmailService(): EmailService {
  return new EmailService(
    createEmailProviders(),
    repositoryFactory.getRateCounterRepository(),
    repositoryFactory.getEmailDeliveryRepository(),
    emailServiceConfig(),
  );
}
