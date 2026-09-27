import { sendThroughChain } from "../../app/email/providerChain";
import {
  EmailProvider,
  EmailProviderError,
  OutgoingEmail,
} from "../../domain/email/EmailProvider";
import { MailpitEmailProvider } from "../../infrastructure/email/MailpitEmailProvider";
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
    throw new EmailProviderError(name, kind, `${kind}-error`, {
      outcome: refused ? "refused" : "mayHaveSent",
    });
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
      durationMs: expect.any(Number),
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
      durationMs: expect.any(Number),
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
      nothingSent: true,
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
      nothingSent: false,
      failures: [{ provider: "ses", error: "TypeError", detail: "boom" }],
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
      nothingSent: true,
    });
    await expect(sendThroughChain([], EMAIL, 1000)).resolves.toEqual({
      accepted: false,
      recipientRejected: false,
      nothingSent: true,
      failures: [],
    });
  });

  it("cannot say nothing went out once a provider timed out or failed without answering", async () => {
    const hangs = provider("ses", () => new Promise(() => undefined));
    await expect(
      sendThroughChain([hangs, fails("mailpit", "transport")], EMAIL, 20),
    ).resolves.toMatchObject({ accepted: false, nothingSent: false });
    await expect(
      sendThroughChain(
        [fails("ses", "transport", false), fails("mailpit", "transport")],
        EMAIL,
        1000,
      ),
    ).resolves.toMatchObject({ accepted: false, nothingSent: false });
  });

  describe("a network error", () => {
    const realFetch = global.fetch;
    const fetchMock = jest.fn();
    const mailpit = (): EmailProvider & { send: jest.Mock } => {
      const adapter = new MailpitEmailProvider("http://localhost:8025");
      return { name: adapter.name, send: jest.fn(adapter.send.bind(adapter)) };
    };
    const fetchFailed = (code: string, syscall: string): TypeError =>
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error(`${syscall} ${code} 127.0.0.1:8025`), {
          code,
          syscall,
        }),
      });
    const accepted = (): Response =>
      new Response(JSON.stringify({ ID: "mp-1" }), { status: 200 });

    beforeEach(() => {
      fetchMock.mockReset();
      global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterAll(() => {
      global.fetch = realFetch;
    });

    it("keeps why a provider failed, not only the error's name", async () => {
      fetchMock.mockRejectedValue(fetchFailed("ECONNRESET", "read"));
      const result = await sendThroughChain([mailpit()], EMAIL, 1000);
      expect(result.failures).toEqual([
        {
          provider: "mailpit",
          error: "TypeError",
          detail: "ECONNRESET · fetch failed · read ECONNRESET 127.0.0.1:8025",
        },
      ]);
    });

    it("tries the same provider once more when the request never left", async () => {
      fetchMock
        .mockRejectedValueOnce(fetchFailed("EAI_AGAIN", "getaddrinfo"))
        .mockResolvedValueOnce(accepted());
      const flaky = mailpit();
      const result = await sendThroughChain([flaky], EMAIL, 1000);
      expect(result).toEqual({
        accepted: true,
        provider: "mailpit",
        messageId: "mp-1",
        failures: [
          {
            provider: "mailpit",
            error: "TypeError",
            detail:
              "EAI_AGAIN · fetch failed · getaddrinfo EAI_AGAIN 127.0.0.1:8025",
          },
        ],
        durationMs: expect.any(Number),
      });
      expect(flaky.send).toHaveBeenCalledTimes(2);
    });

    it("does not try again what may have gone out", async () => {
      fetchMock.mockRejectedValue(fetchFailed("ECONNRESET", "read"));
      const reset = mailpit();
      const result = await sendThroughChain([reset], EMAIL, 1000);
      expect(reset.send).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ accepted: false, nothingSent: false });
    });

    it("tries once more, not until it works, and counts it as nothing sent", async () => {
      fetchMock.mockRejectedValue(fetchFailed("ECONNREFUSED", "connect"));
      const down = mailpit();
      const result = await sendThroughChain([down], EMAIL, 1000);
      expect(down.send).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        accepted: false,
        recipientRejected: false,
        nothingSent: true,
      });
      expect(result.failures).toHaveLength(2);
    });

    it("keeps the second try inside the provider's timeout", async () => {
      fetchMock
        .mockRejectedValueOnce(fetchFailed("EAI_AGAIN", "getaddrinfo"))
        .mockImplementationOnce(() => new Promise(() => undefined));
      const started = Date.now();
      const result = await sendThroughChain([mailpit()], EMAIL, 50);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(result).toMatchObject({
        accepted: false,
        nothingSent: false,
        failures: [
          { provider: "mailpit", error: "TypeError" },
          { provider: "mailpit", error: "Timeout" },
        ],
      });
    });

    it("does not try again once the timeout has aborted the send", async () => {
      const late = provider(
        "ses",
        (_email, signal) =>
          new Promise((_, reject) => {
            signal.addEventListener("abort", () =>
              reject(
                new EmailProviderError("ses", "transport", "Error", {
                  outcome: "neverLeft",
                }),
              ),
            );
          }),
      );
      await sendThroughChain([late], EMAIL, 20);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(late.send).toHaveBeenCalledTimes(1);
    });
  });
});
