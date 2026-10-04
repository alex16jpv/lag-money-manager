/**
 * What the mocked suite cannot see about confirming an email (T-209): the
 * codes and links as a person reads them from the email, the tries counted
 * in mongod, the invitations that wait for a confirmed address and reach the
 * change feed once it is.
 */
import request from "supertest";

import { OutgoingEmail } from "../../domain/email/EmailProvider";
import { AuthCodeModel } from "../../infrastructure/models/AuthCodeModel";
import { RateLimitModel } from "../../infrastructure/models/RateLimitModel";
import { SharedInvitationModel } from "../../infrastructure/models/SharedInvitationModel";
import { UserModel } from "../../infrastructure/models/UserModel";
import { hashEmailAddress } from "../../shared/emailHash";
import {
  connect,
  disconnect,
  dropDatabase,
  signedInUser,
  TEST_CAPTCHA,
} from "./support";

const mockSent: OutgoingEmail[] = [];
const mockUnreachable = new Set<string>();

jest.mock("../../shared/constants", () => {
  process.env.EMAIL_VERIFICATION_REQUIRED = "true";
  return jest.requireActual("../../shared/constants");
});

// A provider that keeps what it is given: this suite reads the code the way a person would.
jest.mock("../../app/factories/emailServiceFactory", () => {
  const actual = jest.requireActual("../../app/factories/emailServiceFactory");
  const { EmailService } = jest.requireActual(
    "../../app/services/EmailService",
  );
  const { EmailProviderError } = jest.requireActual(
    "../../domain/email/EmailProvider",
  );
  const factory = jest.requireActual(
    "../../app/factories/RepositoryFactory",
  ).default;
  const config = actual.emailServiceConfig();
  return {
    ...actual,
    createEmailService: () =>
      new EmailService(
        [
          {
            name: "mailpit",
            send: async (email: OutgoingEmail) => {
              if (mockUnreachable.has(email.to)) {
                throw new EmailProviderError("mailpit", "transport", "down", {
                  outcome: "neverLeft",
                });
              }
              mockSent.push(email);
              return { messageId: `m-${mockSent.length}` };
            },
          },
        ],
        factory.getRateCounterRepository(),
        factory.getEmailDeliveryRepository(),
        factory.getEmailSuppressionRepository(),
        {
          ...config,
          enabled: true,
          providerTimeoutMs: 100,
          brakes: { ...config.brakes, ipHourlyMax: 1000 },
        },
      ),
  };
});

import app from "../../app";

interface Session {
  token: string;
  refreshToken: string;
  userId: string;
}

const PASSWORD = "Offline!2026";

async function accountFromBeforeEmail(
  email: string,
  name: string,
): Promise<Session> {
  const opened = await signedInUser(
    { name, email, password: PASSWORD, currency: "COP" },
    { fromBefore: true },
  );
  return {
    token: opened.accessToken,
    refreshToken: opened.refreshToken,
    userId: opened.user.id,
  };
}

const as = (session: Session, req: request.Test): request.Test =>
  req.set("Authorization", `Bearer ${session.token}`);

interface Profile {
  email: string;
  emailVerified: boolean;
  emailVerification: {
    codeLive: boolean;
    lastSentAt: string | null;
    resendAvailableAt: string | null;
  } | null;
}

const profile = async (session: Session): Promise<Profile> => {
  const res = await as(session, request(app).get(`/users/${session.userId}`));
  expect(res.status).toBe(200);
  return res.body as Profile;
};

const verifyCode = (session: Session, code: string): request.Test =>
  as(session, request(app).post("/auth/email/verify").send({ code }));

const verifyLink = (token: string): request.Test =>
  request(app).post("/auth/email/verify").send({ token });

const resend = (session: Session): request.Test =>
  as(
    session,
    request(app).post("/auth/email/resend").send({ captcha: TEST_CAPTCHA }),
  );

// Only an account from before email is ever sent verify-email, by its Send code.
async function withCode(email: string, name: string): Promise<Session> {
  const session = await accountFromBeforeEmail(email, name);
  expect((await resend(session)).status).toBe(202);
  return session;
}

function lastEmailTo(address: string): {
  code: string;
  token: string;
  text: string;
} {
  const email = [...mockSent].reverse().find((sent) => sent.to === address);
  if (!email) throw new Error(`nothing was sent to ${address}`);
  const code = email.text.match(/\b(\d{6})\b/)?.[1];
  const token = email.text.match(/\/verify#token=([A-Za-z0-9_-]+)/)?.[1];
  if (!code || !token) throw new Error("the email has no code or no link");
  expect(email.text).not.toContain("/not-me");
  return { code, token, text: email.text };
}

const sentTo = (address: string): number =>
  mockSent.filter((sent) => sent.to === address).length;

describe("Confirming an email against mongod [T-209]", () => {
  beforeAll(async () => {
    await connect();
    await dropDatabase();
  });

  afterAll(async () => {
    await disconnect();
  });

  it("mails the code on Send code and shows it live, with Resend's countdown", async () => {
    const ana = await withCode("ana@verify.test", "Ana Ruiz");

    const email = mockSent.find((sent) => sent.to === "ana@verify.test");
    expect(email?.template).toBe("verify-email");
    const me = await profile(ana);
    expect(me.emailVerified).toBe(false);
    expect(me.emailVerification?.codeLive).toBe(true);
    const sentAt = Date.parse(me.emailVerification?.lastSentAt ?? "");
    expect(
      Date.parse(me.emailVerification?.resendAvailableAt ?? "") - sentAt,
    ).toBe(60_000);

    const again = await resend(ana);
    expect(again.status).toBe(429);
    expect(again.body.code).toBe("RATE_LIMITED");
    expect(Number(again.headers["retry-after"])).toBeGreaterThan(0);
    expect(sentTo("ana@verify.test")).toBe(1);
  });

  it("tells a wrong code from a right one, confirms with it, and keeps the link good afterwards", async () => {
    const beto = await withCode("beto@verify.test", "Beto Cano");
    const { code, token } = lastEmailTo("beto@verify.test");
    const wrong = code === "000000" ? "111111" : "000000";

    const refused = await verifyCode(beto, wrong);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("EMAIL_CODE_INVALID");

    expect((await verifyCode(beto, code)).status).toBe(200);
    const me = await profile(beto);
    expect(me.emailVerified).toBe(true);
    expect(me.emailVerification).toBeNull();
    const stored = await UserModel.findById(beto.userId).lean();
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);

    expect((await verifyLink(token)).status).toBe(200);
    expect((await verifyCode(beto, code)).status).toBe(200);
    const already = await resend(beto);
    expect(already.status).toBe(409);
    expect(already.body.code).toBe("EMAIL_ALREADY_VERIFIED");
  });

  it("uses a code up after five wrong tries, even for the right one after them", async () => {
    const cata = await withCode("cata@verify.test", "Cata Diaz");
    const { code } = lastEmailTo("cata@verify.test");
    const wrong = code === "000000" ? "111111" : "000000";

    const tries = [];
    for (let i = 0; i < 5; i++) tries.push(await verifyCode(cata, wrong));
    expect(tries.map((res) => res.body.code)).toEqual(
      Array(5).fill("EMAIL_CODE_INVALID"),
    );

    const after = await verifyCode(cata, code);
    expect(after.status).toBe(400);
    expect(after.body.code).toBe("EMAIL_CODE_EXPIRED");
    expect((await profile(cata)).emailVerification?.codeLive).toBe(false);
    const row = await AuthCodeModel.findOne({
      purpose: "verify",
      toHash: hashEmailAddress("cata@verify.test"),
    }).lean();
    expect(row?.attempts).toBe(5);
  });

  it("leaves no code when its email cannot go out, and Send code goes again at once [T-228]", async () => {
    const dora = await accountFromBeforeEmail("dora@verify.test", "Dora Paz");
    mockUnreachable.add("dora@verify.test");
    try {
      const failed = await resend(dora);
      expect(failed.status).toBe(503);
      expect(failed.body.code).toBe("EMAIL_SEND_FAILED");
    } finally {
      mockUnreachable.delete("dora@verify.test");
    }
    expect(sentTo("dora@verify.test")).toBe(0);
    expect((await profile(dora)).emailVerification).toEqual({
      codeLive: false,
      lastSentAt: null,
      resendAvailableAt: null,
    });

    const sent = await resend(dora);
    expect(sent.status).toBe(202);
    expect((await profile(dora)).emailVerification?.codeLive).toBe(true);
    expect(sentTo("dora@verify.test")).toBe(1);
  });

  it("gives an account from before the email a code from Send code, and confirms it by the link alone", async () => {
    const dani = await accountFromBeforeEmail("dani@verify.test", "Dani Gil");
    expect(sentTo("dani@verify.test")).toBe(0);
    expect((await profile(dani)).emailVerification).toEqual({
      codeLive: false,
      lastSentAt: null,
      resendAvailableAt: null,
    });

    const sent = await resend(dani);
    expect(sent.status).toBe(202);
    expect(sent.body).toEqual({ resendAfterSeconds: 60 });
    expect((await profile(dani)).emailVerification?.codeLive).toBe(true);

    const { token } = lastEmailTo("dani@verify.test");
    expect((await verifyLink(token)).status).toBe(200);
    expect((await profile(dani)).emailVerified).toBe(true);
  });

  it("refuses to move the email on the profile's PUT, and the address keeps its code and link [T-232]", async () => {
    const eva = await withCode("eva@verify.test", "Eva Paz");
    const old = lastEmailTo("eva@verify.test");

    const refused = await as(
      eva,
      request(app)
        .put(`/users/${eva.userId}`)
        .send({ email: "eva.new@verify.test", currentPassword: PASSWORD }),
    );
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("EMAIL_CHANGE_REQUIRES_VERIFICATION");
    expect(sentTo("eva.new@verify.test")).toBe(0);
    expect(
      await RateLimitModel.countDocuments({ _id: /^current-password:/ }),
    ).toBe(0);
    expect(await UserModel.findById(eva.userId).lean()).toMatchObject({
      email: "eva@verify.test",
    });

    expect((await verifyLink(old.token)).status).toBe(200);
    expect(await profile(eva)).toMatchObject({
      email: "eva@verify.test",
      emailVerified: true,
    });
  });

  it("keeps invitations waiting for a confirmed address, and hands them to the feed once it is", async () => {
    const john = await withCode("john@verify.test", "John Doe");
    const unconfirmedInviter = await accountFromBeforeEmail(
      "sam@verify.test",
      "Sam Ray",
    );
    expect(
      (await verifyCode(john, lastEmailTo("john@verify.test").code)).status,
    ).toBe(200);
    const fede = await withCode("fede@verify.test", "Fede Luna");

    const contact = await as(
      john,
      request(app)
        .post("/contacts")
        .send({ name: "Fede", email: "fede@verify.test" }),
    );
    const group = await as(
      john,
      request(app)
        .post("/shared-groups")
        .send({ name: "Trip", contactIds: [contact.body.id] }),
    );
    const invited = await as(
      john,
      request(app)
        .post(`/shared-groups/${group.body.id}/invitations`)
        .send({ contactId: contact.body.id }),
    );
    expect(invited.status).toBe(201);

    const samContact = await as(
      unconfirmedInviter,
      request(app)
        .post("/contacts")
        .send({ name: "Fede", email: "fede@verify.test" }),
    );
    const samGroup = await as(
      unconfirmedInviter,
      request(app)
        .post("/shared-groups")
        .send({ name: "Dinner", contactIds: [samContact.body.id] }),
    );
    const refusedInvite = await as(
      unconfirmedInviter,
      request(app)
        .post(`/shared-groups/${samGroup.body.id}/invitations`)
        .send({ contactId: samContact.body.id }),
    );
    expect(refusedInvite.status).toBe(403);
    expect(refusedInvite.body.code).toBe("EMAIL_NOT_VERIFIED");

    // As if it had arrived long before this copy was made.
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await SharedInvitationModel.updateOne(
      { _id: invited.body.id },
      { $set: { updatedAt: longAgo } },
      { timestamps: false },
    );
    const snapshot = await as(
      fede,
      request(app).get("/sync/changes?limit=100"),
    );
    expect(snapshot.body.changes.invitationsReceived).toEqual([]);
    const since = snapshot.body.serverTime as string;

    const listed = await as(fede, request(app).get("/invitations"));
    expect(listed.status).toBe(403);
    expect(listed.body.code).toBe("EMAIL_NOT_VERIFIED");
    const accept = await as(
      fede,
      request(app).post(`/invitations/${invited.body.id}/accept`),
    );
    expect(accept.body.code).toBe("EMAIL_NOT_VERIFIED");

    expect(
      (await verifyCode(fede, lastEmailTo("fede@verify.test").code)).status,
    ).toBe(200);

    const after = await as(
      fede,
      request(app).get(
        `/sync/changes?limit=100&since=${encodeURIComponent(since)}`,
      ),
    );
    expect(
      (after.body.changes.invitationsReceived as { id: string }[]).map(
        (one) => one.id,
      ),
    ).toEqual([invited.body.id]);
    expect(
      (await as(fede, request(app).get("/invitations"))).body.data,
    ).toHaveLength(1);
    const joined = await as(
      fede,
      request(app).post(`/invitations/${invited.body.id}/accept`),
    );
    expect(joined.status).toBe(200);
    expect(joined.body.status).toBe("ACCEPTED");
  });
});
