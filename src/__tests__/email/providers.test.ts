const sesSend = jest.fn();
const sesClientOptions: unknown[] = [];

jest.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: jest.fn().mockImplementation((options: unknown) => {
    sesClientOptions.push(options);
    return { send: sesSend };
  }),
  SendEmailCommand: jest.fn().mockImplementation((input: unknown) => ({
    input,
  })),
}));

import {
  EmailProviderError,
  OutgoingEmail,
} from "../../domain/email/EmailProvider";
import { MailpitEmailProvider } from "../../infrastructure/email/MailpitEmailProvider";
import { SesEmailProvider } from "../../infrastructure/email/SesEmailProvider";

const EMAIL: OutgoingEmail = {
  to: "ana@example.com",
  from: { name: "Ledger Flow", address: "no-reply@ledgerflow.alexpiral.com" },
  replyTo: "ledgerflow@alexpiral.com",
  subject: "Restablece tu contraseña de Ledger Flow",
  html: "<p>html</p>",
  text: "text",
  template: "password-reset",
  budget: "reset",
};

const awsError = (name: string): Error =>
  Object.assign(new Error(name), { name });

describe("SesEmailProvider", () => {
  beforeEach(() => {
    sesSend.mockReset();
  });

  it("sends one UTF-8 message with its reply-to, tags and configuration set", async () => {
    sesSend.mockResolvedValue({ MessageId: "ses-1" });
    const provider = new SesEmailProvider({
      region: "us-east-1",
      configurationSet: "ledger-flow",
    });
    const signal = new AbortController().signal;

    await expect(provider.send(EMAIL, signal)).resolves.toEqual({
      messageId: "ses-1",
    });

    const [command, options] = sesSend.mock.calls[0];
    expect(options).toEqual({ abortSignal: signal });
    expect(command.input).toEqual({
      FromEmailAddress: '"Ledger Flow" <no-reply@ledgerflow.alexpiral.com>',
      Destination: { ToAddresses: ["ana@example.com"] },
      ReplyToAddresses: ["ledgerflow@alexpiral.com"],
      ConfigurationSetName: "ledger-flow",
      EmailTags: [
        { Name: "template", Value: "password-reset" },
        { Name: "budget", Value: "reset" },
      ],
      Content: {
        Simple: {
          Subject: { Data: EMAIL.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: EMAIL.html, Charset: "UTF-8" },
            Text: { Data: EMAIL.text, Charset: "UTF-8" },
          },
        },
      },
    });
    expect(sesClientOptions).toContainEqual({
      region: "us-east-1",
      maxAttempts: 1,
    });
  });

  it("loads the SDK once for every send", async () => {
    sesSend.mockResolvedValue({ MessageId: "ses-1" });
    const provider = new SesEmailProvider({});
    const before = sesClientOptions.length;
    await provider.send(EMAIL, new AbortController().signal);
    await provider.send(EMAIL, new AbortController().signal);
    expect(sesClientOptions.length - before).toBe(1);
  });

  it("tries loading the SDK again after a load that failed", async () => {
    const { SESv2Client } = jest.requireMock("@aws-sdk/client-sesv2") as {
      SESv2Client: jest.Mock;
    };
    SESv2Client.mockImplementationOnce(() => {
      throw new Error("cold start");
    });
    sesSend.mockResolvedValue({ MessageId: "ses-2" });
    const provider = new SesEmailProvider({});
    await expect(
      provider.send(EMAIL, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "transport" });
    await expect(
      provider.send(EMAIL, new AbortController().signal),
    ).resolves.toEqual({ messageId: "ses-2" });
  });

  it.each([
    ["BadRequestException", "recipient"],
    ["MessageRejected", "transport"],
    ["TooManyRequestsException", "transport"],
    ["LimitExceededException", "transport"],
    ["SendingPausedException", "transport"],
    ["AccountSuspendedException", "transport"],
    ["AbortError", "transport"],
  ])("reads %s as a %s failure", async (name, kind) => {
    sesSend.mockRejectedValue(awsError(name));
    const provider = new SesEmailProvider({});
    const error = await provider
      .send(EMAIL, new AbortController().signal)
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(EmailProviderError);
    expect(error).toMatchObject({ provider: "ses", kind, reason: name });
  });

  it("tells an answered refusal from an error that may have sent it", async () => {
    sesSend.mockRejectedValueOnce(
      Object.assign(awsError("TooManyRequestsException"), {
        $metadata: { httpStatusCode: 429 },
      }),
    );
    sesSend.mockRejectedValueOnce(awsError("AbortError"));
    const provider = new SesEmailProvider({});
    await expect(
      provider.send(EMAIL, new AbortController().signal),
    ).rejects.toMatchObject({ refused: true });
    await expect(
      provider.send(EMAIL, new AbortController().signal),
    ).rejects.toMatchObject({ refused: false });
  });

  it("fails when SES answers without a message id", async () => {
    sesSend.mockResolvedValue({});
    await expect(
      new SesEmailProvider({}).send(EMAIL, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "transport", reason: "NoMessageId" });
  });
});

describe("MailpitEmailProvider", () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  const answer = (status: number, body: unknown): void => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
  };

  it("posts the message to the send API", async () => {
    answer(200, { ID: "mp-1" });
    const signal = new AbortController().signal;
    await expect(
      new MailpitEmailProvider("http://localhost:8025").send(EMAIL, signal),
    ).resolves.toEqual({ messageId: "mp-1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8025/api/v1/send");
    expect(init.signal).toBe(signal);
    expect(JSON.parse(init.body)).toEqual({
      From: {
        Email: "no-reply@ledgerflow.alexpiral.com",
        Name: "Ledger Flow",
      },
      To: [{ Email: "ana@example.com" }],
      ReplyTo: [{ Email: "ledgerflow@alexpiral.com" }],
      Subject: EMAIL.subject,
      HTML: EMAIL.html,
      Text: EMAIL.text,
      Tags: ["password-reset"],
    });
  });

  it.each([
    [400, "recipient"],
    [500, "transport"],
  ])("reads HTTP %s as a %s failure", async (status, kind) => {
    answer(status, {});
    await expect(
      new MailpitEmailProvider("http://localhost:8025").send(
        EMAIL,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind, reason: `HTTP ${status}` });
  });

  it("reads a network error as a transport failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      new MailpitEmailProvider("http://localhost:8025").send(
        EMAIL,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "transport", reason: "TypeError" });
  });

  it("fails when the answer has no id", async () => {
    answer(200, {});
    await expect(
      new MailpitEmailProvider("http://localhost:8025").send(
        EMAIL,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "transport", reason: "NoMessageId" });
  });
});
