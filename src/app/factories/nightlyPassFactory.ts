import { ENVIRONMENT } from "../../shared/constants";
import { emailBudgetSlices } from "../../shared/emailBudgets";
import { NightlyPassService } from "../services/NightlyPassService";
import { createEmailService } from "./emailServiceFactory";
import repositoryFactory from "./RepositoryFactory";

// Half of a day's verification and security slice: the rest stays for the codes people ask for that day.
const deadlineEmailsPerNight = (): number =>
  Math.floor(
    emailBudgetSlices(
      ENVIRONMENT.EMAIL_DAILY_CAP,
      ENVIRONMENT.EMAIL_RESET_SHARE_PERCENT,
      ENVIRONMENT.EMAIL_OTHER_SHARE_PERCENT,
    ).security / 2,
  );

export function createNightlyPassService(): NightlyPassService {
  return new NightlyPassService(
    repositoryFactory.getUserRepository(),
    repositoryFactory.getUserDataEraser(),
    createEmailService(),
    {
      deadlines: ENVIRONMENT.EMAIL_CONFIRMATION_DEADLINES,
      deadlineEmailsPerNight: deadlineEmailsPerNight(),
    },
  );
}
