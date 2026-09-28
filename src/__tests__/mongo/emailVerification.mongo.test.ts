/**
 * What the mocked suite cannot see about confirming an email (T-209): the
 * codes and links as a person reads them from the email, the tries counted
 * in mongod, the invitations that wait for a confirmed address and reach the
 * change feed once it is, and "It wasn't me" erasing an account for good and
 * freeing its address under the unique index.
 */
import request from "supertest";

import { createEmailService } from "../../app/factories/emailServiceFactory";
import repositoryFactory from "../../app/factories/RepositoryFactory";
import { AuthService } from "../../app/services/AuthService";
import { CategoryService } from "../../app/services/CategoryService";
import { OutgoingEmail } from "../../domain/email/EmailProvider";
import { AccountModel } from "../../infrastructure/models/AccountModel";
import { AuthCodeModel } from "../../infrastructure/models/AuthCodeModel";
import { ContactModel } from "../../infrastructure/models/ContactModel";
import { RateLimitModel } from "../../infrastructure/models/RateLimitModel";
import { RefreshSessionModel } from "../../infrastructure/models/RefreshSessionModel";
import { SharedInvitationModel } from "../../infrastructure/models/SharedInvitationModel";
import { UserModel } from "../../infrastructure/models/UserModel";
import { UserDataEraser } from "../../infrastructure/repositories/userData/UserDataEraser";
import { hashEmailAddress } from "../../shared/emailHash";
import { connect, disconnect, dropDatabase, TEST_CAPTCHA } from "./support";

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

async function register(email: string, name: string): Promise<Session> {
  const res = await request(app).post("/auth/register").send({
    captcha: TEST_CAPTCHA,
    name,
    email,
    password: PASSWORD,
    currency: "COP",
  });
  expect(res.status).toBe(201);
  return {
    token: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    userId: res.body.user.id,
  };
}

// Made the way every account from before the email was: by the service, with no email sent.
async function accountFromBeforeEmail(
  email: string,
  name: string,
): Promise<Session> {
  const auth = new AuthService(
    repositoryFactory.getUserRepository(),
    new CategoryService(
      repositoryFactory.getCategoryRepository(),
      repositoryFactory.getTransactionRepository(),
    ),
    repositoryFactory.getRefreshSessionRepository(),
    createEmailService(),
  );
  await auth.register({ name, email, password: PASSWORD });
  const res = await request(app)
    .post("/auth/login")
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return {
    token: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    userId: res.body.user.id,
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

const notMe = (token: string): request.Test =>
  request(app).post("/auth/email/not-me").send({ token });

function lastEmailTo(address: string): {
  code: string;
  token: string;
  notMeToken: string | undefined;
  text: string;
} {
  const email = [...mockSent].reverse().find((sent) => sent.to === address);
  if (!email) throw new Error(`nothing was sent to ${address}`);
  const code = email.text.match(/\b(\d{6})\b/)?.[1];
  const token = email.text.match(/\/verify#token=([A-Za-z0-9_-]+)/)?.[1];
  const notMeToken = email.text.match(/\/not-me#token=([A-Za-z0-9_-]+)/)?.[1];
  if (!code || !token) throw new Error("the email has no code or no link");
  return { code, token, notMeToken, text: email.text };
}

const notMeOf = (address: string): string => {
  const { notMeToken } = lastEmailTo(address);
  if (!notMeToken)
    throw new Error(`the last email to ${address} has no It wasn't me`);
  return notMeToken;
};

const sentTo = (address: string): number =>
  mockSent.filter((sent) => sent.to === address).length;

// What PUT /users/{id} with an email wrote before T-232, bar the tokenVersion that would end the session.
const movedByTheOldPut = async (
  session: Session,
  email: string,
): Promise<void> => {
  await UserModel.updateOne(
    { _id: session.userId },
    {
      $set: {
        email,
        emailVerifiedAt: null,
        emailChangedAt: new Date(),
        emailChange: null,
      },
    },
  );
};

describe("Confirming an email against mongod [T-209]", () => {
  beforeAll(async () => {
    await connect();
    await dropDatabase();
  });

  afterAll(async () => {
    await disconnect();
  });

  it("mails the code at sign-up and shows it live, with Resend's countdown", async () => {
    const ana = await register("ana@verify.test", "Ana Ruiz");

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
    const beto = await register("beto@verify.test", "Beto Cano");
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
    const cata = await register("cata@verify.test", "Cata Diaz");
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

  it("signs up even when its email cannot go out, and its Send code goes at once [T-228]", async () => {
    mockUnreachable.add("dora@verify.test");
    let dora: Session;
    try {
      dora = await register("dora@verify.test", "Dora Paz");
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
    const eva = await register("eva@verify.test", "Eva Paz");
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
      emailChangedAt: null,
    });

    expect((await verifyLink(old.token)).status).toBe(200);
    expect(await profile(eva)).toMatchObject({
      email: "eva@verify.test",
      emailVerified: true,
    });
  });

  it("keeps invitations waiting for a confirmed address, and hands them to the feed once it is", async () => {
    const john = await register("john@verify.test", "John Doe");
    const unconfirmedInviter = await register("sam@verify.test", "Sam Ray");
    expect(
      (await verifyCode(john, lastEmailTo("john@verify.test").code)).status,
    ).toBe(200);
    const fede = await register("fede@verify.test", "Fede Luna");

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

  it("erases the account that used somebody else's address, for good, and frees the address", async () => {
    const occupant = await register("gina@verify.test", "Not Gina");
    const notMeToken = notMeOf("gina@verify.test");
    const account = await as(
      occupant,
      request(app)
        .post("/accounts")
        .send({ name: "Wallet", type: "CASH", balance: 50_000 }),
    );
    expect(account.status).toBe(201);
    await as(
      occupant,
      request(app).post("/contacts").send({ name: "Somebody" }),
    );

    const gone = await notMe(notMeToken);
    expect(gone.status).toBe(200);

    expect(await UserModel.findById(occupant.userId).lean()).toBeNull();
    expect(await AccountModel.countDocuments({ userId: occupant.userId })).toBe(
      0,
    );
    expect(await ContactModel.countDocuments({ userId: occupant.userId })).toBe(
      0,
    );
    expect(
      await RefreshSessionModel.countDocuments({ userId: occupant.userId }),
    ).toBe(0);
    expect(
      await AuthCodeModel.countDocuments({
        toHash: hashEmailAddress("gina@verify.test"),
      }),
    ).toBe(0);
    const refresh = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: occupant.refreshToken });
    expect(refresh.status).toBe(401);

    const gina = await request(app).post("/auth/register").send({
      captcha: TEST_CAPTCHA,
      name: "Gina",
      email: "gina@verify.test",
      password: "Gina's own 2026",
      currency: "COP",
    });
    expect(gina.status).toBe(201);
    expect(gina.body.user.reactivated).toBeUndefined();
    expect(gina.body.user.id).not.toBe(occupant.userId);

    const twice = await notMe(notMeToken);
    expect(twice.status).toBe(400);
    expect(twice.body.code).toBe("LINK_INVALID");
    expect(await UserModel.countDocuments({ email: "gina@verify.test" })).toBe(
      1,
    );
  });

  it("stops It wasn't me once the address is confirmed", async () => {
    const hugo = await register("hugo@verify.test", "Hugo Sol");
    const { code } = lastEmailTo("hugo@verify.test");
    const notMeToken = notMeOf("hugo@verify.test");
    expect((await verifyCode(hugo, code)).status).toBe(200);

    const refused = await notMe(notMeToken);

    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("LINK_INVALID");
    expect(await UserModel.findById(hugo.userId).lean()).not.toBeNull();
  });

  it("frees an address a deleted, never-confirmed account was still holding", async () => {
    const ivan = await register("ivan@verify.test", "Not Ivan");
    const notMeToken = notMeOf("ivan@verify.test");
    const deleted = await as(
      ivan,
      request(app)
        .delete(`/users/${ivan.userId}`)
        .send({ currentPassword: PASSWORD }),
    );
    expect(deleted.status).toBe(200);
    const taken = await request(app).post("/auth/register").send({
      captcha: TEST_CAPTCHA,
      name: "Ivan",
      email: "ivan@verify.test",
      password: "Ivan's own 2026",
    });
    expect(taken.body.code).toBe("EMAIL_TAKEN");

    expect((await notMe(notMeToken)).status).toBe(200);

    const mine = await request(app).post("/auth/register").send({
      captcha: TEST_CAPTCHA,
      name: "Ivan",
      email: "ivan@verify.test",
      password: "Ivan's own 2026",
    });
    expect(mine.status).toBe(201);
  });

  it("finishes It wasn't me on a retry after it failed half-way", async () => {
    const jose = await register("jose@verify.test", "Not Jose");
    const notMeToken = notMeOf("jose@verify.test");
    const spy = jest
      .spyOn(UserDataEraser.prototype, "eraseAccount")
      .mockRejectedValueOnce(new Error("mongod went away"));

    const failed = await notMe(notMeToken);
    expect(failed.status).toBe(500);
    const halfway = await UserModel.findById(jose.userId).lean();
    expect(halfway?.erasingAt).toBeInstanceOf(Date);
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "jose@verify.test", password: PASSWORD });
    expect(login.status).toBe(401);
    const revive = await request(app).post("/auth/register").send({
      captcha: TEST_CAPTCHA,
      name: "Not Jose",
      email: "jose@verify.test",
      password: PASSWORD,
    });
    expect(revive.body.code).toBe("EMAIL_TAKEN");

    expect((await notMe(notMeToken)).status).toBe(200);
    spy.mockRestore();
    expect(await UserModel.findById(jose.userId).lean()).toBeNull();
    const mine = await request(app).post("/auth/register").send({
      captcha: TEST_CAPTCHA,
      name: "Jose",
      email: "jose@verify.test",
      password: "Jose's own 2026",
    });
    expect(mine.status).toBe(201);
  });

  it("never lets It wasn't me erase an account that was confirmed once and moved by the old PUT", async () => {
    const kike = await register("kike@verify.test", "Kike Mar");
    const first = lastEmailTo("kike@verify.test");
    const firstNotMe = notMeOf("kike@verify.test");
    expect((await verifyCode(kike, first.code)).status).toBe(200);

    await movedByTheOldPut(kike, "kike.typo@verify.test");
    expect((await resend(kike)).status).toBe(202);
    const toNew = lastEmailTo("kike.typo@verify.test");
    expect(toNew.notMeToken).toBeUndefined();
    expect(toNew.text).not.toMatch(/Didn.t sign up/);
    await movedByTheOldPut(kike, "kike@verify.test");

    const refused = await notMe(firstNotMe);
    expect(refused.body.code).toBe("LINK_INVALID");
    expect(await UserModel.findById(kike.userId).lean()).not.toBeNull();
  });

  it("stops an old It wasn't me once the old PUT moved the address, even back to the same one", async () => {
    const lola = await register("lola@verify.test", "Not Lola");
    const oldNotMe = notMeOf("lola@verify.test");
    await movedByTheOldPut(lola, "lola.else@verify.test");
    await movedByTheOldPut(lola, "lola@verify.test");

    expect((await notMe(oldNotMe)).body.code).toBe("LINK_INVALID");
    expect(await UserModel.findById(lola.userId).lean()).not.toBeNull();

    // The per-address minute of the sign-up email would hold back Resend.
    await RateLimitModel.deleteMany({
      _id: new RegExp(hashEmailAddress("lola@verify.test")),
    });
    const again = await as(
      lola,
      request(app).post("/auth/email/resend").send({ captcha: TEST_CAPTCHA }),
    );
    expect(again.status).toBe(202);
    const fresh = notMeOf("lola@verify.test");
    expect(fresh).not.toBe(oldNotMe);
    expect((await notMe(fresh)).status).toBe(200);
    expect(await UserModel.findById(lola.userId).lean()).toBeNull();
  });
});
