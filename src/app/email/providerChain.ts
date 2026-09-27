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
      durationMs: number;
    }
  | {
      accepted: false;
      recipientRejected: boolean;
      nothingSent: boolean;
      failures: EmailDeliveryAttempt[];
    };

function asProviderError(
  provider: EmailProviderName,
  err: unknown,
): EmailProviderError {
  return err instanceof EmailProviderError
    ? err
    : new EmailProviderError(
        provider,
        "transport",
        err instanceof Error ? err.name : "UnknownError",
        { cause: err },
      );
}

function attemptOf(failure: EmailProviderError): EmailDeliveryAttempt {
  return failure.detail === undefined
    ? { provider: failure.provider, error: failure.reason }
    : {
        provider: failure.provider,
        error: failure.reason,
        detail: failure.detail,
      };
}

async function sendWithin(
  provider: EmailProvider,
  email: OutgoingEmail,
  timeoutMs: number,
  failures: EmailDeliveryAttempt[],
): Promise<{ messageId: string; durationMs: number }> {
  const controller = new AbortController();
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new EmailProviderError(provider.name, "transport", "Timeout"));
    }, timeoutMs);
  });
  const attempt = async (): Promise<{ messageId: string }> => {
    try {
      return await provider.send(email, controller.signal);
    } catch (err) {
      const failure = asProviderError(provider.name, err);
      if (controller.signal.aborted || failure.outcome !== "neverLeft") {
        throw failure;
      }
      failures.push(attemptOf(failure));
      return provider.send(email, controller.signal);
    }
  };
  try {
    const { messageId } = await Promise.race([attempt(), deadline]);
    return { messageId, durationMs: Date.now() - started };
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
  let nothingSent = true;
  for (const provider of providers) {
    try {
      const { messageId, durationMs } = await sendWithin(
        provider,
        email,
        timeoutMs,
        failures,
      );
      return {
        accepted: true,
        provider: provider.name,
        messageId,
        failures,
        durationMs,
      };
    } catch (err) {
      const failure = asProviderError(provider.name, err);
      failures.push(attemptOf(failure));
      nothingSent &&= failure.nothingSent;
      if (failure.kind === "recipient") {
        return {
          accepted: false,
          recipientRejected: true,
          nothingSent,
          failures,
        };
      }
    }
  }
  return {
    accepted: false,
    recipientRejected: false,
    nothingSent,
    failures,
  };
}
