import {
  EmailProvider,
  EmailProviderError,
  OutgoingEmail,
} from "../../domain/email/EmailProvider";
import { EMAIL_PROVIDER_NAMES } from "../../shared/constants";

export class MailpitEmailProvider implements EmailProvider {
  readonly name = EMAIL_PROVIDER_NAMES.mailpit;

  constructor(private readonly baseUrl: string) {}

  async send(
    email: OutgoingEmail,
    signal: AbortSignal,
  ): Promise<{ messageId: string }> {
    let response: Response;
    try {
      response = await fetch(new URL("/api/v1/send", this.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          From: { Email: email.from.address, Name: email.from.name },
          To: [{ Email: email.to }],
          ReplyTo: [{ Email: email.replyTo }],
          Subject: email.subject,
          HTML: email.html,
          Text: email.text,
          Tags: [email.template],
        }),
        signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.name : "UnknownError";
      throw new EmailProviderError(this.name, "transport", reason, false, err);
    }
    if (!response.ok) {
      throw new EmailProviderError(
        this.name,
        response.status === 400 ? "recipient" : "transport",
        `HTTP ${response.status}`,
        true,
      );
    }
    const body = (await response.json()) as { ID?: unknown };
    if (typeof body.ID !== "string") {
      throw new EmailProviderError(this.name, "transport", "NoMessageId");
    }
    return { messageId: body.ID };
  }
}
