import type { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";

import {
  EmailProvider,
  EmailProviderError,
  OutgoingEmail,
} from "../../domain/email/EmailProvider";
import { EMAIL_PROVIDER_NAMES } from "../../shared/constants";
import { describeError, neverLeft } from "../../shared/errorDetail";

const RECIPIENT_ERRORS = new Set(["BadRequestException"]);
const UNSIGNED_ERRORS = new Set(["CredentialsProviderError"]);

function answeredStatus(err: unknown): number | undefined {
  const status = (err as { $metadata?: { httpStatusCode?: unknown } })
    ?.$metadata?.httpStatusCode;
  return typeof status === "number" ? status : undefined;
}

interface SesOptions {
  region?: string;
  configurationSet?: string;
}

interface SesSdk {
  client: SESv2Client;
  SendEmailCommand: typeof SendEmailCommand;
}

export class SesEmailProvider implements EmailProvider {
  readonly name = EMAIL_PROVIDER_NAMES.ses;
  private sdk: Promise<SesSdk> | null = null;

  constructor(private readonly options: SesOptions) {}

  private loadSdk(): Promise<SesSdk> {
    this.sdk ??= import("@aws-sdk/client-sesv2").then((sdk) => ({
      client: new sdk.SESv2Client({
        region: this.options.region,
        maxAttempts: 1,
      }),
      SendEmailCommand: sdk.SendEmailCommand,
    }));
    this.sdk.catch(() => {
      this.sdk = null;
    });
    return this.sdk;
  }

  async send(
    email: OutgoingEmail,
    signal: AbortSignal,
  ): Promise<{ messageId: string }> {
    let messageId: string | undefined;
    let loaded = false;
    try {
      const { client, SendEmailCommand } = await this.loadSdk();
      loaded = true;
      const output = await client.send(
        new SendEmailCommand({
          FromEmailAddress: `"${email.from.name}" <${email.from.address}>`,
          Destination: { ToAddresses: [email.to] },
          ReplyToAddresses: [email.replyTo],
          ConfigurationSetName: this.options.configurationSet,
          EmailTags: [
            { Name: "template", Value: email.template },
            { Name: "budget", Value: email.budget },
          ],
          Content: {
            Simple: {
              Subject: { Data: email.subject, Charset: "UTF-8" },
              Body: {
                Html: { Data: email.html, Charset: "UTF-8" },
                Text: { Data: email.text, Charset: "UTF-8" },
              },
            },
          },
        }),
        { abortSignal: signal },
      );
      messageId = output.MessageId;
    } catch (err) {
      const reason = err instanceof Error ? err.name : "UnknownError";
      const status = answeredStatus(err);
      throw new EmailProviderError(
        this.name,
        RECIPIENT_ERRORS.has(reason) ? "recipient" : "transport",
        reason,
        {
          outcome:
            status !== undefined
              ? "refused"
              : !loaded || UNSIGNED_ERRORS.has(reason) || neverLeft(err)
                ? "neverLeft"
                : "mayHaveSent",
          cause: err,
          detail: describeError(err, status),
        },
      );
    }
    if (!messageId) {
      throw new EmailProviderError(this.name, "transport", "NoMessageId");
    }
    return { messageId };
  }
}
