import {
  EmailProvider,
  EmailProviderError,
  OutgoingEmail,
} from "../../domain/email/EmailProvider";
import { EmailDeliveryAttempt } from "../../domain/repositories/emailDelivery/IEmailDeliveryRepository";
import { EmailProviderName } from "../../shared/constants";

export type ChainResult =
  | {
      accepted: true;
      provider: EmailProviderName;
      messageId: string;
      failures: EmailDeliveryAttempt[];
    }
  | {
      accepted: false;
      recipientRejected: boolean;
      everyProviderRefused: boolean;
      failures: EmailDeliveryAttempt[];
    };

async function sendWithin(
  provider: EmailProvider,
  email: OutgoingEmail,
  timeoutMs: number,
): Promise<{ messageId: string }> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new EmailProviderError(provider.name, "transport", "Timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      provider.send(email, controller.signal),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function sendThroughChain(
  providers: readonly EmailProvider[],
  email: OutgoingEmail,
  timeoutMs: number,
): Promise<ChainResult> {
  const failures: EmailDeliveryAttempt[] = [];
  let everyProviderRefused = true;
  for (const provider of providers) {
    try {
      const { messageId } = await sendWithin(provider, email, timeoutMs);
      return { accepted: true, provider: provider.name, messageId, failures };
    } catch (err) {
      const failure =
        err instanceof EmailProviderError
          ? err
          : new EmailProviderError(
              provider.name,
              "transport",
              err instanceof Error ? err.name : "UnknownError",
              false,
              err,
            );
      failures.push({ provider: provider.name, error: failure.reason });
      everyProviderRefused &&= failure.refused;
      if (failure.kind === "recipient") {
        return {
          accepted: false,
          recipientRejected: true,
          everyProviderRefused,
          failures,
        };
      }
    }
  }
  return {
    accepted: false,
    recipientRejected: false,
    everyProviderRefused,
    failures,
  };
}
