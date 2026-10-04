/**
 * What the mocked suite cannot see about the security notices (T-211): the
 * notice and its undo link as the old address reads them, the address kept
 * for that link by the unique index on heldEmails (and let go once the link
 * lapsed), the undo written in one pipeline, the code it mails redeemed by the
 * reset, and new-sign-in deciding by the device token a login sends.
 */
import request from "supertest";

import { OutgoingEmail } from "../../domain/email/EmailProvider";
import { RateLimitModel } from "../../infrastructure/models/RateLimitModel";
import { UserModel } from "../../infrastructure/models/UserModel";
import {
  connect,
  disconnect,
  dropDatabase,
  SignedInUser,
  signedInUser,
  TEST_CAPTCHA,
} from "./support";

const mockSent: OutgoingEmail[] = [];

// A provider that keeps what it is given: this suite reads the links the way a person would.
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
  deviceToken: string;
  userId: string;
}

const PASSWORD = "Offline!2026";
const NEW_PASSWORD = "Recovered!2026";

const sessionOf = (body: {
  accessToken: string;
  refreshToken: string;
  deviceToken: string;
  user: { id: string };
}): Session => ({
  token: body.accessToken,
  refreshToken: body.refreshToken,
  deviceToken: body.deviceToken,
  userId: body.user.id,
});

const newAccount = (
  email: string,
  name = "Somebody",
  fromBefore = false,
): Promise<SignedInUser> =>
  signedInUser(
    { name, email, password: PASSWORD, currency: "COP" },
    { fromBefore },
  );

const logIn = (
  email: string,
  password = PASSWORD,
  deviceToken?: string,
): request.Test =>
  request(app)
    .post("/auth/login")
    .send(deviceToken ? { email, password, deviceToken } : { email, password });

const as = (session: Session, req: request.Test): request.Test =>
  req.set("Authorization", `Bearer ${session.token}`);

// The address's own brake allows one email a minute for each purpose.
const minutePasses = async (): Promise<void> => {
  await RateLimitModel.deleteMany({});
};

const sentTo = (address: string, template: string): OutgoingEmail[] =>
  mockSent.filter((sent) => sent.to === address && sent.template === template);

function lastEmail(address: string, template: string): OutgoingEmail {
  const all = sentTo(address, template);
  const email = all[all.length - 1];
  if (!email) throw new Error(`no ${template} was sent to ${address}`);
  return email;
}

const tokenIn = (email: OutgoingEmail, page: string): string => {
  const token = new RegExp(`/${page}#token=([A-Za-z0-9_-]+)`).exec(
    email.text,
  )?.[1];
  if (!token) throw new Error(`the email has no ${page} link`);
  return token;
};

const codeIn = (email: OutgoingEmail): string => {
  const code = /^\s*(\d{6})\s*$/m.exec(email.text)?.[1];
  if (!code) throw new Error("the email has no code");
  return code;
};

async function confirmedAccount(email: string): Promise<Session> {
  return sessionOf(await newAccount(email));
}

const askToMove = (session: Session, email: string): request.Test =>
  as(
    session,
    request(app)
      .post(`/users/${session.userId}/email-change`)
      .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0) Chrome/128.0")
      .send({ email, currentPassword: PASSWORD, captcha: TEST_CAPTCHA }),
  );

async function moveConfirmed(
  session: Session,
  from: string,
  to: string,
): Promise<{ undoToken: string; moved: Session }> {
  expect((await askToMove(session, to)).status).toBe(202);
  const notice = lastEmail(from, "email-change-requested");
  const moved = await as(
    session,
    request(app)
      .post("/auth/email/confirm-change")
      .send({ code: codeIn(lastEmail(to, "email-change-confirm")) }),
  );
  expect(moved.status).toBe(200);
  await minutePasses();
  return { undoToken: tokenIn(notice, "undo"), moved: sessionOf(moved.body) };
}

const undo = (token: string): request.Test =>
  request(app).post("/auth/email/undo").send({ token });

describe("Security notices against mongod [T-211]", () => {
  beforeAll(async () => {
    await connect();
    await dropDatabase();
  });

  afterAll(async () => {
    await disconnect();
  });

  it("tells the old address, keeps it while the undo works, and undoes a confirmed move", async () => {
    const ana = await confirmedAccount("ana@notice.test");
    const { undoToken, moved } = await moveConfirmed(
      ana,
      "ana@notice.test",
      "thief@notice.test",
    );
    const notice = lastEmail("ana@notice.test", "email-change-requested");
    expect(notice.text).toContain("thief@notice.test");
    expect(notice.text).toContain("Chrome");

    await expect(newAccount("ana@notice.test")).rejects.toMatchObject({
      statusCode: 409,
      code: "EMAIL_TAKEN",
    });
    const beto = await confirmedAccount("beto@notice.test");
    const taken = await askToMove(beto, "ana@notice.test");
    expect(taken.status).toBe(202);
    expect(lastEmail("ana@notice.test", "email-change-taken")).toBeDefined();

    const undone = await undo(undoToken);
    expect(undone.status).toBe(200);
    expect(undone.body).toEqual({ email: "ana@notice.test", codeSent: true });

    const stored = await UserModel.findById(ana.userId).lean();
    expect(stored).toMatchObject({
      email: "ana@notice.test",
      emailChange: null,
      undoLinks: [],
      heldEmails: ["ana@notice.test"],
    });
    expect(stored?.devicesResetAt).toBeInstanceOf(Date);
    expect((await logIn("ana@notice.test")).status).toBe(401);
    const stale = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: moved.refreshToken });
    expect(stale.body.code).toBe("REFRESH_REVOKED");
    await expect(newAccount("thief@notice.test")).resolves.toMatchObject({
      user: { email: "thief@notice.test" },
    });
    expect(sentTo("ana@notice.test", "password-changed")).toHaveLength(0);

    const code = codeIn(
      lastEmail("ana@notice.test", "password-reset-after-undo"),
    );
    const reset = await request(app).post("/auth/password/reset").send({
      email: "ana@notice.test",
      code,
      newPassword: NEW_PASSWORD,
    });
    expect(reset.status).toBe(200);
    expect(reset.body.user.email).toBe("ana@notice.test");
    expect((await logIn("ana@notice.test", NEW_PASSWORD)).status).toBe(200);

    const again = await undo(undoToken);
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("LINK_INVALID");
  });

  it("undoes a change that still waits, and its code no longer moves anything", async () => {
    const cata = await confirmedAccount("cata@notice.test");
    expect((await askToMove(cata, "cata.new@notice.test")).status).toBe(202);
    const confirm = lastEmail("cata.new@notice.test", "email-change-confirm");

    const undone = await undo(
      tokenIn(lastEmail("cata@notice.test", "email-change-requested"), "undo"),
    );
    expect(undone.status).toBe(200);
    expect(undone.body.email).toBe("cata@notice.test");

    const late = await request(app)
      .post("/auth/email/confirm-change")
      .send({ token: tokenIn(confirm, "confirm-email") });
    expect(late.body.code).toBe("LINK_INVALID");
    expect((await UserModel.findById(cata.userId).lean())?.email).toBe(
      "cata@notice.test",
    );
  });

  it("stops the undo links issued after the one used, so the owner's first link always wins", async () => {
    const dani = await confirmedAccount("dani@notice.test");
    const first = await moveConfirmed(
      dani,
      "dani@notice.test",
      "dani.b@notice.test",
    );
    const second = await moveConfirmed(
      first.moved,
      "dani.b@notice.test",
      "dani.c@notice.test",
    );

    expect((await undo(first.undoToken)).status).toBe(200);
    const late = await undo(second.undoToken);
    expect(late.body.code).toBe("LINK_INVALID");
    const stored = await UserModel.findById(dani.userId).lean();
    expect(stored?.email).toBe("dani@notice.test");
    expect(stored?.heldEmails).toEqual(["dani@notice.test"]);
  });

  it("keeps the owner's earlier link when a thief undoes with a later one of their own [review]", async () => {
    const owner = await confirmedAccount("owner@notice.test");
    const toThief = await moveConfirmed(
      owner,
      "owner@notice.test",
      "thief.b@notice.test",
    );
    const thiefs = await moveConfirmed(
      toThief.moved,
      "thief.b@notice.test",
      "thief.c@notice.test",
    );

    const byThief = await undo(thiefs.undoToken);
    expect(byThief.body.email).toBe("thief.b@notice.test");
    await expect(newAccount("owner@notice.test")).rejects.toMatchObject({
      statusCode: 409,
      code: "EMAIL_TAKEN",
    });
    await minutePasses();

    const byOwner = await undo(toThief.undoToken);
    expect(byOwner.status).toBe(200);
    expect(byOwner.body.email).toBe("owner@notice.test");
    const stored = await UserModel.findById(owner.userId).lean();
    expect(stored?.email).toBe("owner@notice.test");
    expect(stored?.undoLinks).toEqual([]);
    expect(stored?.heldEmails).toEqual(["owner@notice.test"]);
  });

  it("lets the account ask for its own old address back while it keeps it [review]", async () => {
    const kira = await confirmedAccount("kira@notice.test");
    const { moved } = await moveConfirmed(
      kira,
      "kira@notice.test",
      "kira.new@notice.test",
    );

    const back = await moveConfirmed(
      moved,
      "kira.new@notice.test",
      "kira@notice.test",
    );
    expect((await UserModel.findById(kira.userId).lean())?.email).toBe(
      "kira@notice.test",
    );
    expect(back.undoToken).toEqual(expect.any(String));
  });

  it("refuses the change, and keeps the one that waited, when the old address cannot be told now [owner, 2026-09-28]", async () => {
    const lola = await confirmedAccount("lola@notice.test");
    expect((await askToMove(lola, "lola.first@notice.test")).status).toBe(202);

    const again = await askToMove(lola, "lola.second@notice.test");
    expect(again.status).toBe(429);
    expect(Number(again.headers["retry-after"])).toBeGreaterThan(0);
    const stored = await UserModel.findById(lola.userId).lean();
    expect(stored?.emailChange?.email).toBe("lola.first@notice.test");
    expect(stored?.undoLinks).toHaveLength(1);
  });

  it("says EMAIL_TAKEN at the confirmation when another account kept the address meanwhile, and takes it once that lapsed", async () => {
    const mara = await confirmedAccount("mara@notice.test");
    expect((await askToMove(mara, "wanted@notice.test")).status).toBe(202);
    const nico = await confirmedAccount("wanted@notice.test");
    await moveConfirmed(nico, "wanted@notice.test", "nico@notice.test");

    const code = codeIn(
      lastEmail("wanted@notice.test", "email-change-confirm"),
    );
    const taken = await as(
      mara,
      request(app).post("/auth/email/confirm-change").send({ code }),
    );
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe("EMAIL_TAKEN");

    await UserModel.updateOne(
      { _id: nico.userId },
      { $set: { "undoLinks.$[].expiresAt": new Date(Date.now() - 1000) } },
    );
    await minutePasses();
    const moved = await moveConfirmed(
      mara,
      "mara@notice.test",
      "wanted@notice.test",
    );
    expect(moved.moved.userId).toBe(mara.userId);
    expect((await UserModel.findById(nico.userId).lean())?.heldEmails).toEqual([
      "nico@notice.test",
    ]);
  });

  it("moves and undoes an account from before T-211, which has no heldEmails", async () => {
    const olga = await confirmedAccount("olga@notice.test");
    await UserModel.updateOne(
      { _id: olga.userId },
      { $unset: { heldEmails: 1 } },
    );

    const { undoToken } = await moveConfirmed(
      olga,
      "olga@notice.test",
      "olga.new@notice.test",
    );
    expect(
      (await UserModel.findById(olga.userId).lean())?.heldEmails?.sort(),
    ).toEqual(["olga.new@notice.test", "olga@notice.test"]);
    await expect(newAccount("olga@notice.test")).rejects.toMatchObject({
      statusCode: 409,
      code: "EMAIL_TAKEN",
    });
    expect((await undo(undoToken)).status).toBe(200);
    expect((await UserModel.findById(olga.userId).lean())?.heldEmails).toEqual([
      "olga@notice.test",
    ]);
  });

  it("never lets a new account take the old address while the move that leaves it lands", async () => {
    for (let i = 0; i < 5; i++) {
      const from = `race${i}@notice.test`;
      const pepe = await confirmedAccount(from);
      expect((await askToMove(pepe, `race${i}.new@notice.test`)).status).toBe(
        202,
      );
      const code = codeIn(
        lastEmail(`race${i}.new@notice.test`, "email-change-confirm"),
      );

      const [moved, stolen] = await Promise.all([
        as(
          pepe,
          request(app).post("/auth/email/confirm-change").send({ code }),
        ),
        newAccount(from, "Racer").catch((err: unknown) => err),
      ]);

      expect(moved.status).toBe(200);
      expect(stolen).toMatchObject({ statusCode: 409, code: "EMAIL_TAKEN" });
    }
  });

  it("mails an address that was never confirmed nothing, and keeps it for nobody", async () => {
    const eva = sessionOf(await newAccount("eva@notice.test", "Eva", true));

    expect((await askToMove(eva, "eva.new@notice.test")).status).toBe(202);
    expect(sentTo("eva@notice.test", "email-change-requested")).toHaveLength(0);
    const moved = await as(
      eva,
      request(app)
        .post("/auth/email/confirm-change")
        .send({
          code: codeIn(
            lastEmail("eva.new@notice.test", "email-change-confirm"),
          ),
        }),
    );
    expect(moved.status).toBe(200);
    await expect(newAccount("eva@notice.test")).resolves.toMatchObject({
      user: { email: "eva@notice.test" },
    });
  });

  it("lets the address go once its undo links lapsed, through the unique index", async () => {
    const fede = await confirmedAccount("fede@notice.test");
    await moveConfirmed(fede, "fede@notice.test", "fede.new@notice.test");

    await expect(
      UserModel.create({
        _id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac99",
        name: "Raw",
        email: "raw@notice.test",
        password: "x",
        heldEmails: ["raw@notice.test", "fede@notice.test"],
      }),
    ).rejects.toMatchObject({ code: 11000, keyPattern: { heldEmails: 1 } });

    await UserModel.updateOne(
      { _id: fede.userId },
      { $set: { "undoLinks.$[].expiresAt": new Date(Date.now() - 1000) } },
    );
    await expect(newAccount("fede@notice.test", "Gina")).resolves.toMatchObject(
      {
        user: { email: "fede@notice.test" },
      },
    );
    const released = await UserModel.findById(fede.userId).lean();
    expect(released?.heldEmails).toEqual(["fede.new@notice.test"]);
    expect(released?.undoLinks).toEqual([]);
  });

  it("brings back an account deleted after its email was moved, at the old address [owner, 2026-09-28]", async () => {
    const hugo = await confirmedAccount("hugo@notice.test");
    const { undoToken, moved } = await moveConfirmed(
      hugo,
      "hugo@notice.test",
      "hugo.new@notice.test",
    );

    const deleted = await as(
      moved,
      request(app)
        .delete(`/users/${hugo.userId}`)
        .send({ currentPassword: PASSWORD }),
    );
    expect(deleted.status).toBe(200);
    expect(sentTo("hugo.new@notice.test", "account-deleted")).toHaveLength(1);
    await expect(newAccount("hugo@notice.test")).rejects.toMatchObject({
      statusCode: 409,
      code: "EMAIL_TAKEN",
    });

    const undone = await undo(undoToken);
    expect(undone.status).toBe(200);
    expect(undone.body.email).toBe("hugo@notice.test");
    const stored = await UserModel.findById(hugo.userId).lean();
    expect(stored).toMatchObject({
      email: "hugo@notice.test",
      deletedAt: null,
    });
    const reset = await request(app)
      .post("/auth/password/reset")
      .send({
        email: "hugo@notice.test",
        code: codeIn(
          lastEmail("hugo@notice.test", "password-reset-after-undo"),
        ),
        newPassword: NEW_PASSWORD,
      });
    expect(reset.status).toBe(200);
    expect(reset.body.user.id).toBe(hugo.userId);
    await expect(newAccount("hugo.new@notice.test")).resolves.toMatchObject({
      user: { email: "hugo.new@notice.test" },
    });
  });

  it("tells about a sign-in from an unknown device, and knows a device until Sign out everywhere, through a reset [T-238 E]", async () => {
    const ines = await confirmedAccount("ines@notice.test");

    const known = await logIn("ines@notice.test", PASSWORD, ines.deviceToken);
    expect(known.status).toBe(200);
    expect(sentTo("ines@notice.test", "new-sign-in")).toHaveLength(0);

    const stranger = await logIn("ines@notice.test");
    expect(stranger.status).toBe(200);
    expect(sentTo("ines@notice.test", "new-sign-in")).toHaveLength(1);
    await minutePasses();

    const changed = await as(
      sessionOf(known.body),
      request(app)
        .put(`/users/${ines.userId}`)
        .send({ password: PASSWORD, currentPassword: PASSWORD }),
    );
    expect(changed.status).toBe(200);
    await minutePasses();
    await logIn("ines@notice.test", PASSWORD, ines.deviceToken);
    expect(sentTo("ines@notice.test", "new-sign-in")).toHaveLength(1);

    const out = await as(
      sessionOf(stranger.body),
      request(app).post("/auth/logout-all"),
    );
    expect(out.status).toBe(200);
    await logIn("ines@notice.test", PASSWORD, ines.deviceToken);
    expect(sentTo("ines@notice.test", "new-sign-in")).toHaveLength(2);
    await minutePasses();
    await logIn("ines@notice.test", PASSWORD, out.body.deviceToken);
    expect(sentTo("ines@notice.test", "new-sign-in")).toHaveLength(2);

    await request(app)
      .post("/auth/password/forgot")
      .send({ email: "ines@notice.test", captcha: TEST_CAPTCHA });
    const reset = await request(app)
      .post("/auth/password/reset")
      .send({
        email: "ines@notice.test",
        code: codeIn(lastEmail("ines@notice.test", "password-reset")),
        newPassword: NEW_PASSWORD,
      });
    expect(reset.status).toBe(200);
    expect(sentTo("ines@notice.test", "password-changed")).toHaveLength(2);
    await minutePasses();

    await logIn("ines@notice.test", NEW_PASSWORD, out.body.deviceToken);
    expect(sentTo("ines@notice.test", "new-sign-in")).toHaveLength(2);
    await minutePasses();
    await logIn("ines@notice.test", NEW_PASSWORD, reset.body.deviceToken);
    expect(sentTo("ines@notice.test", "new-sign-in")).toHaveLength(2);
  });

  it("cancels a waiting email change on a reset, and mails the password change of Settings", async () => {
    const juan = await confirmedAccount("juan@notice.test");
    expect((await askToMove(juan, "juan.new@notice.test")).status).toBe(202);
    const confirm = lastEmail("juan.new@notice.test", "email-change-confirm");
    await minutePasses();

    await request(app)
      .post("/auth/password/forgot")
      .send({ email: "juan@notice.test", captcha: TEST_CAPTCHA });
    const reset = await request(app)
      .post("/auth/password/reset")
      .send({
        email: "juan@notice.test",
        code: codeIn(lastEmail("juan@notice.test", "password-reset")),
        newPassword: NEW_PASSWORD,
      });
    expect(reset.status).toBe(200);
    const late = await request(app)
      .post("/auth/email/confirm-change")
      .send({ token: tokenIn(confirm, "confirm-email") });
    expect(late.body.code).toBe("LINK_INVALID");
    expect((await UserModel.findById(juan.userId).lean())?.emailChange).toBe(
      null,
    );
    await minutePasses();

    const session = sessionOf(reset.body);
    const changed = await as(
      session,
      request(app)
        .put(`/users/${session.userId}`)
        .send({ password: PASSWORD, currentPassword: NEW_PASSWORD }),
    );
    expect(changed.status).toBe(200);
    expect(sentTo("juan@notice.test", "password-changed")).toHaveLength(2);
  });

  it("cancels a waiting email change on a password change in Settings [review]", async () => {
    const rosa = await confirmedAccount("rosa@notice.test");
    expect((await askToMove(rosa, "rosa.new@notice.test")).status).toBe(202);
    const confirm = lastEmail("rosa.new@notice.test", "email-change-confirm");

    const changed = await as(
      rosa,
      request(app)
        .put(`/users/${rosa.userId}`)
        .send({ password: NEW_PASSWORD, currentPassword: PASSWORD }),
    );
    expect(changed.status).toBe(200);
    const late = await request(app)
      .post("/auth/email/confirm-change")
      .send({ token: tokenIn(confirm, "confirm-email") });
    expect(late.body.code).toBe("LINK_INVALID");
    expect((await UserModel.findById(rosa.userId).lean())?.emailChange).toBe(
      null,
    );
  });
});
