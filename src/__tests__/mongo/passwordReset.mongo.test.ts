/**
 * What the mocked suite cannot see about Forgot your password? (T-207, T-238):
 * the per-address rows written for every address, the atomic single use of a
 * code, its five tries, and the reset that brings a deleted account back.
 */
import request from "supertest";

import { OutgoingEmail } from "../../domain/email/EmailProvider";
import { IssuedCode } from "../../domain/repositories/authCode/IAuthCodeRepository";
import { AuthCodeModel } from "../../infrastructure/models/AuthCodeModel";
import { UserModel } from "../../infrastructure/models/UserModel";
import { AuthCodeRepository } from "../../infrastructure/repositories/authCode/AuthCodeRepository";
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

  it("mails a deleted account its own words, and the new password restores it [T-238]", async () => {
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
    const email = [...mockSent]
      .reverse()
      .find((sent) => sent.to === "gabi@reset.test");
    expect(email?.text).toContain("This account was deleted on");
    expect(email?.text).toContain(`erased on`);

    const { code } = lastEmailTo("gabi@reset.test");
    const restored = await reset({
      email: "gabi@reset.test",
      code,
      newPassword: "Restored!2026",
    });
    expect(restored.status).toBe(200);
    expect(restored.body.restored).toBe(true);
    const stored = await UserModel.findById(gabi.userId).lean();
    expect(stored).toMatchObject({ deletedAt: null, keptUntil: null });
    expect(
      (
        await request(app)
          .post("/auth/login")
          .send({ email: "gabi@reset.test", password: "Restored!2026" })
      ).status,
    ).toBe(200);
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
    expect(done.body.restored).toBe(false);

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
});
