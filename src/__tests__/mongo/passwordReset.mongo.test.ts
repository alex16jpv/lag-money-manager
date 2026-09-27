/**
 * What the mocked suite cannot see about Forgot your password? and Start fresh
 * (T-207): the per-address rows written for every address, the atomic single
 * use of a code, its five tries, the pipeline that opens "Keep what's in this
 * account?" only on a never-confirmed account, and the erasure behind Start
 * fresh with what it leaves for the other people in Shared.
 */
import jwt from "jsonwebtoken";
import request from "supertest";

import { OutgoingEmail } from "../../domain/email/EmailProvider";
import { IssuedCode } from "../../domain/repositories/authCode/IAuthCodeRepository";
import { AccountModel } from "../../infrastructure/models/AccountModel";
import { AuthCodeModel } from "../../infrastructure/models/AuthCodeModel";
import { CategoryModel } from "../../infrastructure/models/CategoryModel";
import { ContactModel } from "../../infrastructure/models/ContactModel";
import { SharedExpenseModel } from "../../infrastructure/models/SharedExpenseModel";
import { SharedGroupModel } from "../../infrastructure/models/SharedGroupModel";
import { SharedInvitationModel } from "../../infrastructure/models/SharedInvitationModel";
import { TransactionModel } from "../../infrastructure/models/TransactionModel";
import { UserModel } from "../../infrastructure/models/UserModel";
import { AuthCodeRepository } from "../../infrastructure/repositories/authCode/AuthCodeRepository";
import { DEFAULT_CATEGORIES } from "../../shared/defaultCategories";
import { hashEmailAddress } from "../../shared/emailHash";
import { connect, disconnect, dropDatabase, TEST_CAPTCHA } from "./support";

const mockSent: OutgoingEmail[] = [];

// A provider that keeps what it is given: this suite reads the code the way a person would.
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

const as = (session: Session, req: request.Test): request.Test =>
  req.set("Authorization", `Bearer ${session.token}`);

async function created(req: request.Test): Promise<string> {
  const res = await req;
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const forgot = (email: string): request.Test =>
  request(app)
    .post("/auth/password/forgot")
    .send({ email, captcha: TEST_CAPTCHA });

const reset = (body: Record<string, unknown>): request.Test =>
  request(app)
    .post("/auth/password/reset")
    .send({ newPassword: "Brand new 2026", ...body });

const resetsSent = (): OutgoingEmail[] =>
  mockSent.filter((email) => email.template === "password-reset");

function lastEmailTo(address: string): { code: string; token: string } {
  const email = [...mockSent].reverse().find((sent) => sent.to === address);
  if (!email) throw new Error(`nothing was sent to ${address}`);
  const code = email.text.match(/\b(\d{6})\b/)?.[1];
  const token = email.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
  if (!code || !token) throw new Error("the email has no code or no link");
  return { code, token };
}

describe("Forgot your password? against mongod [T-207]", () => {
  beforeAll(async () => {
    await connect();
    await dropDatabase();
  });

  afterAll(async () => {
    await disconnect();
  });

  it("answers an address with an account and one without alike, and mails only the first", async () => {
    await register("ana@reset.test", "Ana Ruiz");

    const withAccount = await forgot("ana@reset.test");
    const without = await forgot("nobody@reset.test");

    expect(withAccount.status).toBe(202);
    expect(without.status).toBe(202);
    expect(without.body).toEqual(withAccount.body);
    expect(withAccount.body).toEqual({ resendAfterSeconds: 60 });
    expect(resetsSent().map((email) => email.to)).toEqual(["ana@reset.test"]);

    const rows = await AuthCodeModel.find({ purpose: "reset" }).lean();
    const byHash = new Map(rows.map((row) => [row.toHash, row]));
    expect(byHash.get(hashEmailAddress("ana@reset.test"))?.codes).toHaveLength(
      1,
    );
    expect(byHash.get(hashEmailAddress("nobody@reset.test"))).toMatchObject({
      userId: null,
      codes: [],
    });

    const againWith = await forgot("ana@reset.test");
    const againWithout = await forgot("nobody@reset.test");
    expect(againWith.status).toBe(429);
    expect(againWithout.status).toBe(429);
    expect(againWith.body.code).toBe("RATE_LIMITED");
    expect(Number(againWithout.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("mails nothing to a deleted account, and answers it like any other address", async () => {
    const gabi = await register("gabi@reset.test", "Gabi Borra");
    const deleted = await as(
      gabi,
      request(app)
        .delete(`/users/${gabi.userId}`)
        .send({ currentPassword: PASSWORD }),
    );
    expect(deleted.status).toBe(200);

    const res = await forgot("gabi@reset.test");

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ resendAfterSeconds: 60 });
    expect(resetsSent().some((email) => email.to === "gabi@reset.test")).toBe(
      false,
    );
    const row = await AuthCodeModel.findOne({
      purpose: "reset",
      toHash: hashEmailAddress("gabi@reset.test"),
    }).lean();
    expect(row).toMatchObject({ userId: null, codes: [] });
  });

  it("changes the password once, signs every old session out and confirms the email", async () => {
    const before = await request(app)
      .post("/auth/login")
      .send({ email: "ana@reset.test", password: PASSWORD });
    const { code, token } = lastEmailTo("ana@reset.test");

    const done = await reset({ email: "ana@reset.test", code });
    expect(done.status).toBe(200);
    expect(typeof done.body.accessToken).toBe("string");
    expect(typeof done.body.deviceToken).toBe("string");
    expect(done.body.user.keepOrStartFresh).toBeNull();

    const stored = await UserModel.findOne({ email: "ana@reset.test" }).lean();
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);

    const oldRefresh = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: before.body.refreshToken });
    expect(oldRefresh.body.code).toBe("REFRESH_REVOKED");
    expect(
      (
        await request(app)
          .post("/auth/login")
          .send({ email: "ana@reset.test", password: PASSWORD })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/auth/login")
          .send({ email: "ana@reset.test", password: "Brand new 2026" })
      ).status,
    ).toBe(200);

    expect((await reset({ email: "ana@reset.test", code })).body.code).toBe(
      "RESET_CODE_INVALID",
    );
    expect((await reset({ token })).body.code).toBe("LINK_INVALID");
  });

  it("spends a code in five tries, and counts the tries of an address with no account too", async () => {
    await register("beto@reset.test", "Beto Cano");
    expect((await forgot("beto@reset.test")).status).toBe(202);
    const { code } = lastEmailTo("beto@reset.test");
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i++) {
      expect(
        (await reset({ email: "beto@reset.test", code: wrong })).body.code,
      ).toBe("RESET_CODE_INVALID");
    }
    expect((await reset({ email: "beto@reset.test", code })).body.code).toBe(
      "RESET_CODE_INVALID",
    );

    await reset({ email: "nobody@reset.test", code: "123456" });
    const nobody = await AuthCodeModel.findOne({
      purpose: "reset",
      toHash: hashEmailAddress("nobody@reset.test"),
    }).lean();
    expect(nobody?.attempts).toBe(1);
  });

  it("lets one of two resets with the same code through, never both", async () => {
    await register("carla@reset.test", "Carla Díaz");
    expect((await forgot("carla@reset.test")).status).toBe(202);
    const { code } = lastEmailTo("carla@reset.test");

    const answers = await Promise.all([
      reset({ email: "carla@reset.test", code }),
      reset({ email: "carla@reset.test", code }),
    ]);

    expect(answers.map((res) => res.status).sort()).toEqual([200, 400]);
  });

  it("keeps the newest live code next to a new one only when asked to", async () => {
    const codes = new AuthCodeRepository();
    const toHash = hashEmailAddress("keeper@reset.test");
    const soon = (minutes: number): Date =>
      new Date(Date.now() + minutes * 60_000);
    const code = (name: string, expiresAt = soon(30)): IssuedCode => ({
      codeHash: name,
      tokenHash: `${name}-token`,
      expiresAt,
    });
    const live = async (): Promise<string[]> =>
      ((await AuthCodeModel.findOne({ toHash }).lean())?.codes ?? []).map(
        (issued) => issued.codeHash,
      );

    await codes.recordRequest("reset", toHash, "user-1", soon(30));
    await codes.issue("reset", toHash, code("a"), false, new Date());
    await codes.issue("reset", toHash, code("b"), true, new Date());
    expect(await live()).toEqual(["a", "b"]);
    await codes.issue("reset", toHash, code("c"), true, new Date());
    expect(await live()).toEqual(["b", "c"]);
    await codes.issue("reset", toHash, code("d"), false, new Date());
    expect(await live()).toEqual(["d"]);

    await codes.issue(
      "reset",
      toHash,
      code("gone", soon(-1)),
      false,
      new Date(),
    );
    await codes.issue("reset", toHash, code("e"), true, new Date());
    expect(await live()).toEqual(["e"]);
  });

  describe("an account whose email was never confirmed", () => {
    let dani: Session;
    let eli: Session;
    let fede: Session;
    let staleCursor: string;

    beforeAll(async () => {
      dani = await register("dani@reset.test", "Dani Ocupa");
      eli = await register("eli@reset.test", "Eli Invitada");
      fede = await register("fede@reset.test", "Fede Dueño");

      const account = await created(
        as(
          dani,
          request(app)
            .post("/accounts")
            .send({ name: "Wallet", type: "CASH", balance: 100000 }),
        ),
      );
      const categories = await as(dani, request(app).get("/categories"));
      const expense = (
        categories.body.data as { id: string; type: string }[]
      ).find((c) => c.type === "EXPENSE")?.id;
      await created(
        as(
          dani,
          request(app).post("/transactions").send({
            type: "EXPENSE",
            amount: 25000,
            date: "2026-09-20T15:00:00.000Z",
            fromAccountId: account,
            categoryId: expense,
            description: "Lunch",
          }),
        ),
      );

      const eliContact = await created(
        as(
          dani,
          request(app)
            .post("/contacts")
            .send({ name: "Eli", email: "eli@reset.test" }),
        ),
      );
      const group = await created(
        as(
          dani,
          request(app)
            .post("/shared-groups")
            .send({ name: "Trip", contactIds: [eliContact] }),
        ),
      );
      await created(
        as(
          dani,
          request(app).post(`/shared-groups/${group}/expenses`).send({
            description: "Cabin",
            date: "2026-09-19T15:00:00.000Z",
            amount: 90000,
          }),
        ),
      );
      const invitation = await as(
        dani,
        request(app)
          .post(`/shared-groups/${group}/invitations`)
          .send({ contactId: eliContact }),
      );
      expect(
        (
          await as(
            eli,
            request(app).post(`/invitations/${invitation.body.id}/accept`),
          )
        ).status,
      ).toBe(200);

      const daniContact = await created(
        as(
          fede,
          request(app)
            .post("/contacts")
            .send({ name: "Dani", email: "dani@reset.test" }),
        ),
      );
      const fedeGroup = await created(
        as(
          fede,
          request(app)
            .post("/shared-groups")
            .send({ name: "Flat", contactIds: [daniContact] }),
        ),
      );
      const toDani = await as(
        fede,
        request(app)
          .post(`/shared-groups/${fedeGroup}/invitations`)
          .send({ contactId: daniContact }),
      );
      expect(
        (
          await as(
            dani,
            request(app).post(`/invitations/${toDani.body.id}/accept`),
          )
        ).status,
      ).toBe(200);

      const pulled = await as(
        dani,
        request(app).get("/sync/changes").query({ limit: 1000 }),
      );
      staleCursor = pulled.body.pagination.nextCursor;
    });

    it("opens Keep what's in this account? with what it held, and keeps it open", async () => {
      expect((await forgot("dani@reset.test")).status).toBe(202);
      const { code } = lastEmailTo("dani@reset.test");

      const done = await reset({ email: "dani@reset.test", code });

      expect(done.status).toBe(200);
      expect(done.body.user.keepOrStartFresh).toEqual({
        createdAt: expect.any(String),
        accounts: 1,
        transactions: 1,
      });
      dani = {
        token: done.body.accessToken,
        refreshToken: done.body.refreshToken,
        userId: dani.userId,
      };
      const profile = await as(dani, request(app).get(`/users/${dani.userId}`));
      expect(profile.body.keepOrStartFresh).toMatchObject({
        accounts: 1,
        transactions: 1,
      });
    });

    it("lets no access token from before the reset answer it", async () => {
      const before = jwt.sign(
        {
          userId: dani.userId,
          email: "dani@reset.test",
          iat: Math.floor(Date.now() / 1000) - 120,
        },
        process.env.JWT_SECRET as string,
        { algorithm: "HS256", expiresIn: "15m" },
      );

      const res = await request(app)
        .post(`/users/${dani.userId}/keep-or-start-fresh`)
        .set("Authorization", `Bearer ${before}`)
        .send({ choice: "keep" });

      expect(res.status).toBe(401);
      const stored = await UserModel.findById(dani.userId).lean();
      expect(stored?.keepOrStartFresh).not.toBeNull();
    });

    it("starts fresh: erases for good, leaves Shared, and sends every older copy back to the start", async () => {
      const startFresh = (): request.Test =>
        as(
          dani,
          request(app).post(`/users/${dani.userId}/keep-or-start-fresh`).send({
            choice: "start-fresh",
            name: "Dani Real",
            locale: "es",
            currency: "EUR",
            timezone: "Europe/Madrid",
          }),
        );

      const [first, second] = await Promise.all([startFresh(), startFresh()]);
      const [res, other] =
        first.status === 200 ? [first, second] : [second, first];

      expect(res.status).toBe(200);
      expect(other.status).toBe(409);
      expect([
        "START_FRESH_IN_PROGRESS",
        "KEEP_OR_START_FRESH_CLOSED",
      ]).toContain(other.body.code);
      expect(res.body).toMatchObject({
        name: "Dani Real",
        locale: "es",
        currency: "EUR",
        timezone: "Europe/Madrid",
        keepOrStartFresh: null,
        email: "dani@reset.test",
      });

      const userId = dani.userId;
      expect(await AccountModel.countDocuments({ userId })).toBe(0);
      expect(await TransactionModel.countDocuments({ userId })).toBe(0);
      expect(await ContactModel.countDocuments({ userId })).toBe(0);
      expect(await SharedGroupModel.countDocuments({ userId })).toBe(0);
      expect(await SharedExpenseModel.countDocuments({ userId })).toBe(0);
      expect(await CategoryModel.countDocuments({ userId })).toBe(
        DEFAULT_CATEGORIES.length,
      );

      const toEli = await SharedInvitationModel.findOne({
        email: "eli@reset.test",
      }).lean();
      expect(toEli).toMatchObject({
        status: "WITHDRAWN",
        userId: `retired:${userId}`,
      });
      const fromFede = await SharedInvitationModel.findOne({
        userId: fede.userId,
      }).lean();
      expect(fromFede).toMatchObject({
        status: "LEFT",
        inviteeId: `retired:${userId}`,
      });

      const stale = await as(
        dani,
        request(app).get("/sync/changes").query({ cursor: staleCursor }),
      );
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe("RESYNC_REQUIRED");

      const snapshot = await as(
        dani,
        request(app).get("/sync/changes").query({ limit: 1000 }),
      );
      expect(snapshot.status).toBe(200);
      expect(snapshot.body.changes.accounts).toEqual([]);
      expect(snapshot.body.changes.invitationsSent).toEqual([]);
      expect(snapshot.body.changes.invitationsReceived).toEqual([]);
      expect(snapshot.body.changes.categories).toHaveLength(
        DEFAULT_CATEGORIES.length,
      );
      const next = await as(
        dani,
        request(app)
          .get("/sync/changes")
          .query({ cursor: snapshot.body.pagination.nextCursor }),
      );
      expect(next.status).toBe(200);

      const eliFeed = await as(
        eli,
        request(app).get("/sync/changes").query({ limit: 1000 }),
      );
      expect(
        (eliFeed.body.changes.invitationsReceived as { status: string }[]).map(
          (row) => row.status,
        ),
      ).toEqual(["WITHDRAWN"]);
      expect(eliFeed.body.changes.joinedGroups).toEqual([]);

      const again = await as(
        dani,
        request(app)
          .post(`/users/${dani.userId}/keep-or-start-fresh`)
          .send({ choice: "keep" }),
      );
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("KEEP_OR_START_FRESH_CLOSED");
    });
  });
});
