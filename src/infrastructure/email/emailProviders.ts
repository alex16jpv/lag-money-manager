import { EmailProvider } from "../../domain/email/EmailProvider";
import { EMAIL_PROVIDER_NAMES, ENVIRONMENT } from "../../shared/constants";
import { MailpitEmailProvider } from "./MailpitEmailProvider";
import { SesEmailProvider } from "./SesEmailProvider";

export function createEmailProviders(): EmailProvider[] {
  return ENVIRONMENT.EMAIL_PROVIDERS.map((name) =>
    name === EMAIL_PROVIDER_NAMES.ses
      ? new SesEmailProvider({
          region: ENVIRONMENT.EMAIL_SES_REGION,
          configurationSet: ENVIRONMENT.EMAIL_SES_CONFIGURATION_SET,
        })
      : new MailpitEmailProvider(ENVIRONMENT.MAILPIT_URL),
  );
}
