import { sendThroughChain } from "../../app/email/providerChain";
import {
  EmailProvider,
  EmailProviderError,
  OutgoingEmail,
} from "../../domain/email/EmailProvider";
import { EmailProviderName } from "../../shared/constants";

const EMAIL: OutgoingEmail = {
  to: "ana@example.com",
  from: { name: "Ledger Flow", address: "no-reply@ledgerflow.alexpiral.com" },
  replyTo: "ledgerflow@alexpiral.com",
  subject: "Subject",
  html: "<p>html</p>",
  text: "text",
  template: "password-reset",
  budget: "reset",
};

const provider = (
  name: EmailProviderName,
  send: EmailProvider["send"],
): EmailProvider & { send: jest.Mock } => ({
  name,
  send: jest.fn(send),
});

type FakeProvider = EmailProvider & { send: jest.Mock };

const accepts = (name: EmailProviderName, messageId: string): FakeProvider =>
  provider(name, async () => ({ messageId }));
const fails = (
  name: EmailProviderName,
  kind: "recipient" | "transport",
  refused = true,
): FakeProvider =>
  provider(name, async () => {
    throw new EmailProviderError(name, kind, `${kind}-error`, refused);
  });

describe("sendThroughChain", () => {
  it("sends with the first provider when it accepts", async () => {
    const first = accepts("ses", "m-1");
    const second = accepts("mailpit", "m-2");
    const result = await sendThroughChain([first, second], EMAIL, 1000);
    expect(result).toEqual({
      accepted: true,
      provider: "ses",
      messageId: "m-1",
      failures: [],
    });
    expect(second.send).not.toHaveBeenCalled();
  });

  it("falls to the next provider on a transport failure", async () => {
    const second = accepts("mailpit", "m-2");
    const result = await sendThroughChain(
      [fails("ses", "transport"), second],
      EMAIL,
      1000,
    );
    expect(result).toEqual({
      accepted: true,
      provider: "mailpit",
      messageId: "m-2",
      failures: [{ provider: "ses", error: "transport-error" }],
    });
  });

  it("stops on a recipient failure: the next provider would refuse it too", async () => {
    const second = accepts("mailpit", "m-2");
    const result = await sendThroughChain(
      [fails("ses", "recipient"), second],
      EMAIL,
      1000,
    );
    expect(result).toEqual({
      accepted: false,
      recipientRejected: true,
      everyProviderRefused: true,
      failures: [{ provider: "ses", error: "recipient-error" }],
    });
    expect(second.send).not.toHaveBeenCalled();
  });

  it("gives up on a provider at the timeout, even if it ignores the signal", async () => {
    const hangs = provider("ses", () => new Promise(() => undefined));
    const second = accepts("mailpit", "m-2");
    const started = Date.now();
    const result = await sendThroughChain([hangs, second], EMAIL, 50);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result).toMatchObject({
      accepted: true,
      provider: "mailpit",
      failures: [{ provider: "ses", error: "Timeout" }],
    });
    const signal = hangs.send.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(true);
  });

  it("treats an unexpected error as a transport failure", async () => {
    const throws = provider("ses", async () => {
      throw new TypeError("boom");
    });
    const result = await sendThroughChain([throws], EMAIL, 1000);
    expect(result).toEqual({
      accepted: false,
      recipientRejected: false,
      everyProviderRefused: false,
      failures: [{ provider: "ses", error: "TypeError" }],
    });
  });

  it("fails when every provider fails, and when there is none", async () => {
    await expect(
      sendThroughChain(
        [fails("ses", "transport"), fails("mailpit", "transport")],
        EMAIL,
        1000,
      ),
    ).resolves.toMatchObject({
      accepted: false,
      recipientRejected: false,
      everyProviderRefused: true,
    });
    await expect(sendThroughChain([], EMAIL, 1000)).resolves.toEqual({
      accepted: false,
      recipientRejected: false,
      everyProviderRefused: true,
      failures: [],
    });
  });

  it("cannot say nothing went out once a provider timed out or failed without answering", async () => {
    const hangs = provider("ses", () => new Promise(() => undefined));
    await expect(
      sendThroughChain([hangs, fails("mailpit", "transport")], EMAIL, 20),
    ).resolves.toMatchObject({ accepted: false, everyProviderRefused: false });
    await expect(
      sendThroughChain(
        [fails("ses", "transport", false), fails("mailpit", "transport")],
        EMAIL,
        1000,
      ),
    ).resolves.toMatchObject({ accepted: false, everyProviderRefused: false });
  });
});
