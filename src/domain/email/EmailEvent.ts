import { EmailEventKind, EmailProviderName } from "../../shared/constants";

export interface EmailEvent {
  provider: EmailProviderName;
  messageId: string;
  kind: EmailEventKind;
  recipients: string[];
  // True for a hard bounce or a complaint: the addresses must not be sent to again.
  suppress: boolean;
  at: Date;
  detail: string | null;
}
