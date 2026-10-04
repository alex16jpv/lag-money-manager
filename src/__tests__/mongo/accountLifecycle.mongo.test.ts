/**
 * What the mocked suite cannot see about T-238: an account that exists only
 * once its code is typed, under the unique indexes; a deleted account kept 30
 * days and restored three ways; the nightly pass that erases it for good and
 * frees its address; and the deadline of the accounts from before email.
 */
import request from "supertest";

import { createNightlyPassService } from "../../app/factories/nightlyPassFactory";
import { OutgoingEmail } from "../../domain/email/EmailProvider";
import { AccountModel } from "../../infrastructure/models/AccountModel";
import { RateLimitModel } from "../../infrastructure/models/RateLimitModel";
import { RefreshSessionModel } from "../../infrastructure/models/RefreshSessionModel";
import { SignUpModel } from "../../infrastructure/models/SignUpModel";
import { UserModel } from "../../infrastructure/models/UserModel";
import {
  connect,
  disconnect,
  dropDatabase,
  signedInUser,
  TEST_CAPTCHA,
} from "./support";

const mockSent: OutgoingEmail[] = [];

jest.mock("../../shared/constants", () => {
  process.env.EMAIL_CONFIRMATION_DEADLINES = "true";
  return jest.requireActual("../../shared/constants");
});

// A provider that keeps what it is given: this suite reads the codes and links the way a person would.
jest.mock("../../app/factories/emailServiceFactory", () => {
  const actual = jest.requireActual("../../app/factories/emailServiceFactory");
  const { EmailService } = jest.requireActual(
    "../../app/services/EmailService",
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

const PASSWORD = "Offline!2026";
const DAY_MS = 24 * 60 * 60 * 1000;

interface Session {
  token: string;
  userId: string;
}

const sessionOf = (body: {
  accessToken: string;
  user: { id: string };
}): Session => ({ token: body.accessToken, userId: body.user.id });

const as = (session: Session, req: request.Test): request.Test =>
  req.set("Authorization", `Bearer ${session.token}`);

// The address's own brake allows one email a minute for each purpose.
const minutePasses = async (): Promise<void> => {
  await RateLimitModel.deleteMany({});
};

const lastEmail = (address: string, template: string): OutgoingEmail => {
  const email = [...mockSent]
    .reverse()
    .find((sent) => sent.to === address && sent.template === template);
  if (!email) throw new Error(`no ${template} was sent to ${address}`);
  return email;
};

const codeIn = (email: OutgoingEmail): string => {
  const code = /\b(\d{6})\b/.exec(email.text)?.[1];
  if (!code) throw new Error(`${email.template} carries no code`);
  return code;
};

const tokenIn = (email: OutgoingEmail, page: string): string => {
  const token = new RegExp(`/${page}#token=([A-Za-z0-9_-]+)`).exec(
    email.text,
  )?.[1];
  if (!token) throw new Error(`${email.template} has no /${page} link`);
  return token;
};

const startSignUp = (email: string, password = PASSWORD): request.Test =>
  request(app).post("/auth/sign-up").send({
    captcha: TEST_CAPTCHA,
    name: "Somebody",
    email,
    password,
    currency: "COP",
    timezone: "America/Bogota",
  });

const confirmSignUp = (signUpToken: string, code: string): request.Test =>
  request(app).post("/auth/sign-up/confirm").send({ signUpToken, code });

const verifyLink = (token: string): request.Test =>
  request(app).post("/auth/email/verify").send({ token });

async function confirmedAccount(email: string): Promise<Session> {
  await minutePasses();
  const started = await startSignUp(email);
  expect(started.status).toBe(202);
  const done = await confirmSignUp(
    started.body.signUpToken,
    codeIn(lastEmail(email, "sign-up")),
  );
  expect(done.status).toBe(201);
  return sessionOf(done.body);
}

const logIn = (email: string, password = PASSWORD): request.Test =>
  request(app).post("/auth/login").send({ email, password });

const remove = (session: Session): request.Test =>
  as(
    session,
    request(app)
      .delete(`/users/${session.userId}`)
      .send({ currentPassword: PASSWORD }),
  );

describe("The account lifecycle against mongod [T-238]", () => {
  beforeAll(async () => {
    await connect();
    await dropDatabase();
  });

  afterAll(async () => {
    await disconnect();
  });

  describe("creating an account", () => {
    it("creates nothing until the code is typed, then signs in this browser once", async () => {
      const started = await startSignUp("ana@life.test");
      expect(started.status).toBe(202);
      expect(started.body).toEqual({
        signUpToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        expiresAt: expect.any(String),
        resendAfterSeconds: 60,
      });
      expect(await UserModel.countDocuments({ email: "ana@life.test" })).toBe(
        0,
      );
      const email = lastEmail("ana@life.test", "sign-up");

      const wrong = await confirmSignUp(started.body.signUpToken, "000000");
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe("SIGN_UP_CODE_INVALID");

      const done = await confirmSignUp(started.body.signUpToken, codeIn(email));
      expect(done.status).toBe(201);
      expect(done.body.user).toMatchObject({
        email: "ana@life.test",
        emailVerified: true,
        confirmBy: null,
        emailConfirmationRequired: false,
        currency: "COP",
      });
      expect(done.body.deviceToken).toEqual(expect.any(String));
      expect(mockSent.some((sent) => sent.template === "new-sign-in")).toBe(
        false,
      );

      const twice = await confirmSignUp(
        started.body.signUpToken,
        codeIn(email),
      );
      expect(twice.body.code).toBe("SIGN_UP_CODE_INVALID");
      const link = await verifyLink(tokenIn(email, "verify"));
      expect(link.status).toBe(200);
      expect(link.body.result).toBe("account-ready");
    });

    it("answers an address with an account the same, mails account-exists, and never creates one", async () => {
      await minutePasses();
      const started = await startSignUp("ana@life.test", "Another!2026");
      expect(started.status).toBe(202);
      expect(Object.keys(started.body).sort()).toEqual([
        "expiresAt",
        "resendAfterSeconds",
        "signUpToken",
      ]);
      expect(lastEmail("ana@life.test", "account-exists").text).toContain(
        "already has one",
      );

      for (const code of ["000000", "123456"]) {
        const res = await confirmSignUp(started.body.signUpToken, code);
        expect(res.body.code).toBe("SIGN_UP_CODE_INVALID");
      }
      expect(await UserModel.countDocuments({ email: "ana@life.test" })).toBe(
        1,
      );
      expect((await logIn("ana@life.test", "Another!2026")).status).toBe(401);
    });

    it("lets the link create the account with no session, and the code sign in afterwards", async () => {
      await minutePasses();
      const started = await startSignUp("beto@life.test");
      const email = lastEmail("beto@life.test", "sign-up");

      const link = await verifyLink(tokenIn(email, "verify"));
      expect(link.body).toEqual({
        message: expect.any(String),
        result: "account-ready",
      });
      expect(link.body).not.toHaveProperty("accessToken");
      expect(
        await UserModel.findOne({ email: "beto@life.test" }).lean(),
      ).toMatchObject({ emailVerifiedAt: expect.any(Date) });

      const signedIn = await confirmSignUp(
        started.body.signUpToken,
        codeIn(email),
      );
      expect(signedIn.status).toBe(201);
      expect((await logIn("beto@life.test")).status).toBe(200);
    });

    it("lets a newer sign-up of the address replace the older one", async () => {
      await minutePasses();
      const first = await startSignUp("cata@life.test");
      const firstCode = codeIn(lastEmail("cata@life.test", "sign-up"));
      await minutePasses();
      const second = await startSignUp("cata@life.test", "Second!2026");

      expect(
        (await confirmSignUp(first.body.signUpToken, firstCode)).body.code,
      ).toBe("SIGN_UP_CODE_INVALID");
      const resend = await request(app)
        .post("/auth/sign-up/resend")
        .send({ signUpToken: first.body.signUpToken, captcha: TEST_CAPTCHA });
      expect(resend.body.code).toBe("SIGN_UP_EXPIRED");

      const firstLink = tokenIn(
        [...mockSent].find(
          (sent) => sent.to === "cata@life.test" && sent.template === "sign-up",
        ) as OutgoingEmail,
        "verify",
      );
      expect((await verifyLink(firstLink)).body.code).toBe("LINK_INVALID");
      expect(
        (await confirmSignUp(second.body.signUpToken, firstCode)).body.code,
      ).toBe("SIGN_UP_CODE_INVALID");
      expect(await UserModel.countDocuments({ email: "cata@life.test" })).toBe(
        0,
      );

      const done = await confirmSignUp(
        second.body.signUpToken,
        codeIn(lastEmail("cata@life.test", "sign-up")),
      );
      expect(done.status).toBe(201);
      expect((await logIn("cata@life.test", "Second!2026")).status).toBe(200);
      expect(await SignUpModel.countDocuments({})).toBeGreaterThan(0);
    });

    it("answers EMAIL_TAKEN to the code when the address became another account's meanwhile, and lets go of its claim", async () => {
      await minutePasses();
      const started = await startSignUp("race@life.test");
      const code = codeIn(lastEmail("race@life.test", "sign-up"));
      const other = await signedInUser({
        name: "Faster",
        email: "race@life.test",
        password: "Faster!2026",
      });

      const late = await confirmSignUp(started.body.signUpToken, code);

      expect(late.status).toBe(409);
      expect(late.body.code).toBe("EMAIL_TAKEN");
      expect(late.body).not.toHaveProperty("accessToken");
      expect(
        await UserModel.find({ email: "race@life.test" }).distinct("_id"),
      ).toEqual([other.user.id]);
      expect(
        await SignUpModel.findOne({ email: "race@life.test" }).lean(),
      ).toMatchObject({ userId: null, signedInAt: null });
    });
  });

  describe("a deleted account", () => {
    it("keeps everything 30 days, and signing in with its password brings it back with a notice", async () => {
      const dani = await confirmedAccount("dani@life.test");
      const wallet = await as(
        dani,
        request(app)
          .post("/accounts")
          .send({ name: "Wallet", type: "CASH", balance: 5000 }),
      );
      expect(wallet.status).toBe(201);

      const deleted = await remove(dani);
      expect(deleted.status).toBe(200);
      expect(deleted.body.keptUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const notice = lastEmail("dani@life.test", "account-deleted");
      expect(tokenIn(notice, "restore")).toMatch(/^[A-Za-z0-9_-]{64}$/);

      expect((await logIn("dani@life.test", "Wrong!2026")).status).toBe(401);
      const signIn = await logIn("dani@life.test");
      expect(signIn.status).toBe(409);
      expect(signIn.body).toMatchObject({
        code: "ACCOUNT_DELETED",
        deletedAccount: { keptUntil: deleted.body.keptUntil },
      });

      const restored = await request(app)
        .post("/auth/login/restore")
        .send({ email: "dani@life.test", password: PASSWORD });
      expect(restored.status).toBe(200);
      const back = sessionOf(restored.body);
      const account = await as(
        back,
        request(app).get(`/accounts/${wallet.body.id}`),
      );
      expect(account.status).toBe(200);
      expect(lastEmail("dani@life.test", "account-restored").text).toContain(
        "was restored by signing in",
      );
    });

    it("lets whoever did not delete it restore it from the email, and stops the password", async () => {
      const eva = await confirmedAccount("eva@life.test");
      expect((await remove(eva)).status).toBe(200);
      const token = tokenIn(
        lastEmail("eva@life.test", "account-deleted"),
        "restore",
      );

      const restored = await request(app)
        .post("/auth/email/restore")
        .send({ token });
      expect(restored.status).toBe(200);
      expect(restored.body).toEqual({ email: "eva@life.test", codeSent: true });
      expect((await logIn("eva@life.test")).status).toBe(401);

      const again = await request(app)
        .post("/auth/email/restore")
        .send({ token });
      expect(again.body.code).toBe("LINK_INVALID");

      const reset = lastEmail("eva@life.test", "password-reset-after-undo");
      expect(reset.text).toContain("You restored your account");
      const chosen = await request(app)
        .post("/auth/password/reset")
        .send({
          email: "eva@life.test",
          code: codeIn(reset),
          newPassword: "Chosen!2026",
        });
      expect(chosen.status).toBe(200);
      expect(chosen.body.restored).toBe(false);
    });

    it("is erased for good by the first nightly pass after its last day, and its address is free", async () => {
      const fede = await confirmedAccount("fede@life.test");
      await as(
        fede,
        request(app)
          .post("/accounts")
          .send({ name: "Wallet", type: "CASH", balance: 100 }),
      );
      expect((await remove(fede)).status).toBe(200);
      await UserModel.updateOne(
        { _id: fede.userId },
        { $set: { keptUntil: new Date(Date.now() - 1000) } },
      );

      const report = await createNightlyPassService().run(10_000);

      expect(report.erased).toBeGreaterThanOrEqual(1);
      expect(await UserModel.findById(fede.userId).lean()).toBeNull();
      expect(await AccountModel.countDocuments({ userId: fede.userId })).toBe(
        0,
      );
      expect(
        await RefreshSessionModel.countDocuments({ userId: fede.userId }),
      ).toBe(0);
      expect((await logIn("fede@life.test")).status).toBe(401);
      const again = await confirmedAccount("fede@life.test");
      expect(again.userId).not.toBe(fede.userId);
    });

    it("gives its address up to a new account before the pass, once its days are over", async () => {
      const gina = await confirmedAccount("gina@life.test");
      expect((await remove(gina)).status).toBe(200);
      await UserModel.updateOne(
        { _id: gina.userId },
        { $set: { keptUntil: new Date(Date.now() - 1000) } },
      );

      const fresh = await confirmedAccount("gina@life.test");

      expect(fresh.userId).not.toBe(gina.userId);
      expect(await UserModel.findById(gina.userId).lean()).toMatchObject({
        email: `${gina.userId}@erasing.invalid`,
        erasingAt: expect.any(Date),
      });
      await createNightlyPassService().run(10_000);
      expect(await UserModel.findById(gina.userId).lean()).toBeNull();
    });

    it("gives an account deleted before T-238 its 30 days from the first pass", async () => {
      const hugo = await confirmedAccount("hugo@life.test");
      expect((await remove(hugo)).status).toBe(200);
      await UserModel.updateOne(
        { _id: hugo.userId },
        { $set: { keptUntil: null, deletedAt: new Date("2026-01-10") } },
      );

      await createNightlyPassService().run(10_000);

      const stored = await UserModel.findById(hugo.userId).lean();
      expect(stored?.keptUntil?.getTime()).toBeGreaterThan(
        Date.now() + 29 * DAY_MS,
      );
      expect(stored?.keptUntil?.getTime()).toBeLessThan(
        Date.now() + 32 * DAY_MS,
      );
    });
  });

  describe("an account from before email existed", () => {
    const fromBefore = async (email: string): Promise<Session> =>
      sessionOf(
        await signedInUser(
          { name: "Old", email, password: PASSWORD },
          { fromBefore: true },
        ),
      );

    it("gets its deadline from the pass, and its link confirms it until then", async () => {
      const iris = await fromBefore("iris@life.test");
      await minutePasses();

      const report = await createNightlyPassService().run(10_000);

      expect(report.deadlines).toBeGreaterThanOrEqual(1);
      const email = lastEmail("iris@life.test", "confirm-deadline");
      expect(email.subject).toMatch(/^Confirm your email for Ledger Flow by /);
      const signedIn = await logIn("iris@life.test");
      expect(signedIn.body.user.confirmBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(signedIn.body.user.emailConfirmationRequired).toBe(false);

      const confirmed = await verifyLink(tokenIn(email, "verify"));
      expect(confirmed.body.result).toBe("email-confirmed");
      expect(
        (await as(iris, request(app).get(`/users/${iris.userId}`))).body
          .emailVerified,
      ).toBe(true);
    });

    it("asks for the confirmation first past its deadline, and lets everything through once it is", async () => {
      const jose = await fromBefore("jose@life.test");
      await minutePasses();
      await createNightlyPassService().run(10_000);
      const link = tokenIn(
        lastEmail("jose@life.test", "confirm-deadline"),
        "verify",
      );
      await UserModel.updateOne(
        { _id: jose.userId },
        { $set: { "confirmDeadline.endsAt": new Date(Date.now() - 1000) } },
      );

      const signedIn = await logIn("jose@life.test");
      expect(signedIn.status).toBe(200);
      expect(signedIn.body.user.emailConfirmationRequired).toBe(true);
      const late = sessionOf(signedIn.body);

      const blocked = await as(late, request(app).get("/accounts"));
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe("EMAIL_CONFIRMATION_REQUIRED");
      expect(
        (await as(late, request(app).get(`/users/${late.userId}`))).status,
      ).toBe(200);
      expect((await verifyLink(link)).body.code).toBe("LINK_INVALID");

      await minutePasses();
      const sent = await as(
        late,
        request(app).post("/auth/email/resend").send({ captcha: TEST_CAPTCHA }),
      );
      expect(sent.status).toBe(202);
      const code = codeIn(lastEmail("jose@life.test", "verify-email"));
      const verified = await as(
        late,
        request(app).post("/auth/email/verify").send({ code }),
      );
      expect(verified.status).toBe(200);
      expect((await as(late, request(app).get("/accounts"))).status).toBe(200);
    });

    it("is reminded once, four days before its deadline", async () => {
      const kike = await fromBefore("kike@life.test");
      await minutePasses();
      await createNightlyPassService().run(10_000);
      await UserModel.updateOne(
        { _id: kike.userId },
        {
          $set: {
            "confirmDeadline.endsAt": new Date(Date.now() + 3.5 * DAY_MS),
            "confirmDeadline.day": new Date(Date.now() + 3 * DAY_MS)
              .toISOString()
              .slice(0, 10),
          },
        },
      );
      await minutePasses();

      const report = await createNightlyPassService().run(10_000);

      expect(report.reminders).toBe(1);
      expect(
        lastEmail("kike@life.test", "confirm-deadline-reminder").subject,
      ).toMatch(/^[1-4] days? left to confirm your email for Ledger Flow$/);
      await minutePasses();
      expect((await createNightlyPassService().run(10_000)).reminders).toBe(0);
    });
  });
});
