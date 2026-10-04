/**
 * What the mocked suite cannot see about changing the email (T-221): the
 * code and the link as a person reads them from the email, the move written
 * in one pipeline, the unique index deciding when the address was taken
 * meanwhile, the sessions it ends and the one it keeps, and the invitations
 * that reach the new address once it is confirmed.
 */
import request from "supertest";

import { emailChangeKey } from "../../app/services/authCodes";
import { OutgoingEmail } from "../../domain/email/EmailProvider";
import { AuthCodeModel } from "../../infrastructure/models/AuthCodeModel";
import { RateLimitModel } from "../../infrastructure/models/RateLimitModel";
import { RefreshSessionModel } from "../../infrastructure/models/RefreshSessionModel";
import { SharedInvitationModel } from "../../infrastructure/models/SharedInvitationModel";
import { UserModel } from "../../infrastructure/models/UserModel";
import {
  connect,
  disconnect,
  dropDatabase,
  signedInUser,
  TEST_CAPTCHA,
} from "./support";

const mockSent: OutgoingEmail[] = [];
const mockUnreachable = new Set<string>();
const mockMaybeSent = new Set<string>();

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
              if (mockMaybeSent.has(email.to)) {
                mockSent.push(email);
                throw new EmailProviderError("mailpit", "transport", "reset", {
                  outcome: "mayHaveSent",
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

async function account(
  email: string,
  name: string,
  fromBefore: boolean,
): Promise<Session> {
  const opened = await signedInUser(
    { name, email, password: PASSWORD, currency: "COP" },
    { fromBefore },
  );
  return {
    token: opened.accessToken,
    refreshToken: opened.refreshToken,
    userId: opened.user.id,
  };
}

const accountFromBefore = (email: string, name: string): Promise<Session> =>
  account(email, name, true);

const confirmedAccount = (email: string, name: string): Promise<Session> =>
  account(email, name, false);

async function login(email: string): Promise<Session> {
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

const askToMove = (
  session: Session,
  email: string,
  currentPassword = PASSWORD,
): request.Test =>
  as(
    session,
    request(app)
      .post(`/users/${session.userId}/email-change`)
      .send({ email, currentPassword, captcha: TEST_CAPTCHA }),
  );

const resendChange = (session: Session): request.Test =>
  as(
    session,
    request(app)
      .post(`/users/${session.userId}/email-change/resend`)
      .send({ captcha: TEST_CAPTCHA }),
  );

const cancelChange = (session: Session): request.Test =>
  as(session, request(app).delete(`/users/${session.userId}/email-change`));

const confirmCode = (session: Session, code: string): request.Test =>
  as(session, request(app).post("/auth/email/confirm-change").send({ code }));

const confirmLink = (token: string, refreshToken?: string): request.Test =>
  request(app)
    .post("/auth/email/confirm-change")
    .send(refreshToken ? { token, refreshToken } : { token });

const refresh = (refreshToken: string): request.Test =>
  request(app).post("/auth/refresh").send({ refreshToken });

interface Profile {
  email: string;
  emailVerified: boolean;
  emailChange: {
    email: string;
    expiresAt: string;
    resendAvailableAt: string | null;
  } | null;
}

const profile = async (session: Session): Promise<Profile> => {
  const res = await as(session, request(app).get(`/users/${session.userId}`));
  expect(res.status).toBe(200);
  return res.body as Profile;
};

function lastEmailTo(address: string): {
  template: string;
  code: string;
  token: string;
} {
  const email = [...mockSent].reverse().find((sent) => sent.to === address);
  if (!email) throw new Error(`nothing was sent to ${address}`);
  const code = email.text.match(/\b(\d{6})\b/)?.[1];
  const token = email.text.match(
    /\/(?:confirm-email|verify)#token=([A-Za-z0-9_-]+)/,
  )?.[1];
  if (!code || !token) throw new Error("the email has no code or no link");
  return { template: email.template, code, token };
}

// The address's own brake allows one email a minute, whichever account asks.
const minutePasses = async (): Promise<void> => {
  await RateLimitModel.deleteMany({});
};

const sentTo = (address: string): number =>
  mockSent.filter((sent) => sent.to === address).length;

describe("Changing the email against mongod [T-221]", () => {
  beforeAll(async () => {
    await connect();
    await dropDatabase();
  });

  afterAll(async () => {
    await disconnect();
  });

  it("waits for the new address, moves the account with its code and keeps only this device signed in", async () => {
    const ana = await confirmedAccount("ana@change.test", "Ana Ruiz");
    const phone = await login("ana@change.test");

    const asked = await askToMove(ana, "ana.ruiz@change.test");
    expect(asked.status).toBe(202);
    expect(asked.body.resendAfterSeconds).toBe(60);
    expect(asked.body.emailChange.email).toBe("ana.ruiz@change.test");
    const email = lastEmailTo("ana.ruiz@change.test");
    expect(email.template).toBe("email-change-confirm");

    const waiting = await profile(ana);
    expect(waiting).toMatchObject({
      email: "ana@change.test",
      emailVerified: true,
      emailChange: { email: "ana.ruiz@change.test" },
    });
    const left = Date.parse(waiting.emailChange?.expiresAt ?? "") - Date.now();
    expect(left).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect((await refresh(phone.refreshToken)).status).toBe(200);

    const moved = await confirmCode(ana, email.code);
    expect(moved.status).toBe(200);
    expect(moved.body.user).toMatchObject({
      email: "ana.ruiz@change.test",
      emailVerified: true,
    });
    expect(typeof moved.body.deviceToken).toBe("string");

    const stale = await refresh(ana.refreshToken);
    expect(stale.body.code).toBe("REFRESH_REVOKED");
    expect((await refresh(phone.refreshToken)).body.code).toBe(
      "REFRESH_REVOKED",
    );
    const kept = await refresh(moved.body.refreshToken);
    expect(kept.status).toBe(200);

    const now = { ...ana, token: kept.body.accessToken };
    expect((await profile(now)).emailChange).toBeNull();
    const listed = await as(now, request(app).get("/auth/sessions"));
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].current).toBe(true);

    const stored = await UserModel.findById(ana.userId).lean();
    expect(stored).toMatchObject({
      email: "ana.ruiz@change.test",
      emailChange: null,
      tokenVersion: 1,
    });
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);

    expect(
      (
        await request(app)
          .post("/auth/login")
          .send({ email: "ana.ruiz@change.test", password: PASSWORD })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/auth/login")
          .send({ email: "ana@change.test", password: PASSWORD })
      ).status,
    ).toBe(401);

    const spent = await confirmLink(email.token);
    expect(spent.body.code).toBe("LINK_INVALID");
  });

  it("moves the account from the link, and keeps this browser's session only when it is the account's", async () => {
    const beto = await accountFromBefore("beto@change.test", "Beto Cano");
    const cata = await accountFromBefore("cata@change.test", "Cata Diaz");

    expect((await askToMove(beto, "beto.new@change.test")).status).toBe(202);
    const withSession = await confirmLink(
      lastEmailTo("beto.new@change.test").token,
      beto.refreshToken,
    );
    expect(withSession.status).toBe(200);
    expect(withSession.body.user.email).toBe("beto.new@change.test");
    expect((await refresh(withSession.body.refreshToken)).status).toBe(200);
    expect((await refresh(beto.refreshToken)).body.code).toBe(
      "REFRESH_REVOKED",
    );

    expect((await askToMove(cata, "cata.new@change.test")).status).toBe(202);
    const othersSession = await confirmLink(
      lastEmailTo("cata.new@change.test").token,
      withSession.body.refreshToken,
    );
    expect(othersSession.status).toBe(200);
    expect(othersSession.body.user.email).toBe("cata.new@change.test");
    expect(othersSession.body).not.toHaveProperty("accessToken");
    expect((await refresh(cata.refreshToken)).body.code).toBe(
      "REFRESH_REVOKED",
    );
  });

  it("confirms a never-confirmed account through its new address, and mails the old one nothing", async () => {
    const dani = await accountFromBefore("dani@change.test", "Dani Gil");

    expect((await askToMove(dani, "dani.gil@change.test")).status).toBe(202);
    const moved = await confirmCode(
      dani,
      lastEmailTo("dani.gil@change.test").code,
    );
    expect(moved.status).toBe(200);
    expect(moved.body.user.emailVerified).toBe(true);
    const stored = await UserModel.findById(dani.userId).lean();
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(sentTo("dani@change.test")).toBe(0);
  });

  it("replaces a waiting change with a newer one, and the first one's code and link stop working", async () => {
    const eva = await accountFromBefore("eva@change.test", "Eva Paz");

    expect((await askToMove(eva, "eva.first@change.test")).status).toBe(202);
    const first = lastEmailTo("eva.first@change.test");
    expect((await askToMove(eva, "eva.second@change.test")).status).toBe(202);
    expect((await profile(eva)).emailChange?.email).toBe(
      "eva.second@change.test",
    );

    const oldLink = await confirmLink(first.token);
    expect(oldLink.body.code).toBe("LINK_INVALID");
    const oldCode = await confirmCode(eva, first.code);
    expect(oldCode.status).toBe(400);
    expect((await UserModel.findById(eva.userId).lean())?.email).toBe(
      "eva@change.test",
    );

    const second = lastEmailTo("eva.second@change.test");
    expect((await confirmLink(second.token)).status).toBe(200);
    expect((await UserModel.findById(eva.userId).lean())?.email).toBe(
      "eva.second@change.test",
    );
  });

  it("cancels a waiting change, and its link no longer moves anything", async () => {
    const fede = await accountFromBefore("fede@change.test", "Fede Luna");

    expect((await askToMove(fede, "fede.new@change.test")).status).toBe(202);
    const { token, code } = lastEmailTo("fede.new@change.test");
    expect((await cancelChange(fede)).status).toBe(200);
    expect((await cancelChange(fede)).status).toBe(200);

    expect((await profile(fede)).emailChange).toBeNull();
    const row = await AuthCodeModel.findOne({
      purpose: "email-change",
      toHash: emailChangeKey(fede.userId, "fede.new@change.test"),
    }).lean();
    expect(row?.codes).toEqual([]);
    expect((await confirmLink(token)).body.code).toBe("LINK_INVALID");
    const byCode = await confirmCode(fede, code);
    expect(byCode.status).toBe(409);
    expect(byCode.body.code).toBe("EMAIL_CHANGE_NOT_PENDING");
    expect((await resendChange(fede)).body.code).toBe(
      "EMAIL_CHANGE_NOT_PENDING",
    );
  });

  it("drops the change when the address became another account's meanwhile, as the unique index says", async () => {
    const gina = await accountFromBefore("gina@change.test", "Gina Mar");

    expect((await askToMove(gina, "taken@change.test")).status).toBe(202);
    const { token } = lastEmailTo("taken@change.test");
    await accountFromBefore("taken@change.test", "Somebody Else");

    const refused = await confirmLink(token);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("EMAIL_TAKEN");
    const stored = await UserModel.findById(gina.userId).lean();
    expect(stored).toMatchObject({
      email: "gina@change.test",
      emailChange: null,
      tokenVersion: 0,
    });
    expect((await refresh(gina.refreshToken)).status).toBe(200);

    await minutePasses();
    const asked = await askToMove(gina, "taken@change.test");
    expect(asked.status).toBe(202);
    expect(asked.body.emailChange.email).toBe("taken@change.test");
    expect(
      [...mockSent].reverse().find((sent) => sent.to === "taken@change.test")
        ?.template,
    ).toBe("email-change-taken");
  });

  it("saves nothing when the email to the new address cannot go out", async () => {
    const hugo = await accountFromBefore("hugo@change.test", "Hugo Sol");
    mockUnreachable.add("hugo.new@change.test");
    try {
      const failed = await askToMove(hugo, "hugo.new@change.test");
      expect(failed.status).toBe(503);
      expect(failed.body.code).toBe("EMAIL_SEND_FAILED");
    } finally {
      mockUnreachable.delete("hugo.new@change.test");
    }
    expect((await profile(hugo)).emailChange).toBeNull();
  });

  it("guards the request with the current password and Resend with the address's own brake", async () => {
    const ines = await accountFromBefore("ines@change.test", "Ines Rey");

    const wrong = await askToMove(ines, "ines.new@change.test", "not-it");
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("CURRENT_PASSWORD_INVALID");
    const same = await askToMove(ines, "ines@change.test");
    expect(same.status).toBe(400);
    expect(same.body.code).toBe("VALIDATION");

    expect((await askToMove(ines, "ines.new@change.test")).status).toBe(202);
    const tooSoon = await resendChange(ines);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.code).toBe("RATE_LIMITED");
    expect(sentTo("ines.new@change.test")).toBe(1);
  });

  it("uses a code up after five wrong tries", async () => {
    const juan = await accountFromBefore("juan@change.test", "Juan Ros");
    expect((await askToMove(juan, "juan.new@change.test")).status).toBe(202);
    const { code } = lastEmailTo("juan.new@change.test");
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i++) {
      expect((await confirmCode(juan, wrong)).body.code).toBe(
        "EMAIL_CODE_INVALID",
      );
    }
    const after = await confirmCode(juan, code);
    expect(after.body.code).toBe("EMAIL_CODE_EXPIRED");
    const row = await AuthCodeModel.findOne({
      purpose: "email-change",
      toHash: emailChangeKey(juan.userId, "juan.new@change.test"),
    }).lean();
    expect(row?.attempts).toBe(5);
    expect((await UserModel.findById(juan.userId).lean())?.email).toBe(
      "juan@change.test",
    );
  });

  it("ends the session rows of a password change, so Active sessions lists only the device that made it", async () => {
    const kike = await accountFromBefore("kike@change.test", "Kike Paz");
    await login("kike@change.test");

    const changed = await as(
      kike,
      request(app)
        .put(`/users/${kike.userId}`)
        .send({ password: "Another!2026", currentPassword: PASSWORD }),
    );
    expect(changed.status).toBe(200);
    const live = await RefreshSessionModel.countDocuments({
      userId: kike.userId,
      revokedAt: null,
    });
    expect(live).toBe(0);
  });

  it("hands the invitations waiting for the new address to the feed once it is confirmed, and keeps the answer through the next move", async () => {
    const lola = await confirmedAccount("lola@change.test", "Lola Paz");
    const mario = await confirmedAccount("mario@change.test", "Mario Gil");

    const contact = await as(
      lola,
      request(app)
        .post("/contacts")
        .send({ name: "Mario", email: "mario.work@change.test" }),
    );
    const group = await as(
      lola,
      request(app)
        .post("/shared-groups")
        .send({ name: "Trip", contactIds: [contact.body.id] }),
    );
    const invited = await as(
      lola,
      request(app)
        .post(`/shared-groups/${group.body.id}/invitations`)
        .send({ contactId: contact.body.id }),
    );
    expect(invited.status).toBe(201);
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await SharedInvitationModel.updateOne(
      { _id: invited.body.id },
      { $set: { updatedAt: longAgo } },
      { timestamps: false },
    );

    const snapshot = await as(
      mario,
      request(app).get("/sync/changes?limit=100"),
    );
    const since = snapshot.body.serverTime as string;
    expect((await askToMove(mario, "mario.work@change.test")).status).toBe(202);
    expect(
      (await as(mario, request(app).get("/invitations"))).body.data,
    ).toHaveLength(0);

    const moved = await confirmCode(
      mario,
      lastEmailTo("mario.work@change.test").code,
    );
    expect(moved.status).toBe(200);
    const now = { ...mario, token: moved.body.accessToken };
    const after = await as(
      now,
      request(app).get(
        `/sync/changes?limit=100&since=${encodeURIComponent(since)}`,
      ),
    );
    expect(
      (after.body.changes.invitationsReceived as { id: string }[]).map(
        (one) => one.id,
      ),
    ).toEqual([invited.body.id]);

    const accepted = await as(
      now,
      request(app).post(`/invitations/${invited.body.id}/accept`),
    );
    expect(accepted.status).toBe(200);
    expect((await askToMove(now, "mario.home@change.test")).status).toBe(202);
    const movedAgain = await confirmCode(
      now,
      lastEmailTo("mario.home@change.test").code,
    );
    expect(movedAgain.status).toBe(200);
    const home = { ...mario, token: movedAgain.body.accessToken };
    const feed = await as(home, request(app).get("/sync/changes?limit=100"));
    expect(feed.body.changes.invitationsReceived).toEqual([
      expect.objectContaining({ id: invited.body.id, status: "ACCEPTED" }),
    ]);
  });

  it("keeps each account's code and link its own when two ask for the same address [review]", async () => {
    const nora = await accountFromBefore("nora@change.test", "Nora Paz");
    const otto = await accountFromBefore("otto@change.test", "Otto Gil");

    expect((await askToMove(nora, "shared@change.test")).status).toBe(202);
    const noras = lastEmailTo("shared@change.test");
    await minutePasses();
    expect((await askToMove(otto, "shared@change.test")).status).toBe(202);
    const ottos = lastEmailTo("shared@change.test");

    const moved = await confirmCode(nora, noras.code);
    expect(moved.status).toBe(200);
    expect(moved.body.user.email).toBe("shared@change.test");
    const late = await confirmLink(ottos.token);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("EMAIL_TAKEN");
    expect((await UserModel.findById(otto.userId).lean())?.email).toBe(
      "otto@change.test",
    );
  });

  it("never lets another account's request turn somebody's link into its own move [review]", async () => {
    const pia = await accountFromBefore("pia@change.test", "Pia Sol");
    const quim = await accountFromBefore("quim@change.test", "Quim Ros");

    expect((await askToMove(pia, "inbox@change.test")).status).toBe(202);
    const pias = lastEmailTo("inbox@change.test");
    await minutePasses();
    mockMaybeSent.add("inbox@change.test");
    try {
      expect((await askToMove(quim, "inbox@change.test")).status).toBe(202);
    } finally {
      mockMaybeSent.delete("inbox@change.test");
    }

    const confirmed = await confirmLink(pias.token);
    expect(confirmed.status).toBe(200);
    expect((await UserModel.findById(pia.userId).lean())?.email).toBe(
      "inbox@change.test",
    );
    expect((await UserModel.findById(quim.userId).lean())?.email).toBe(
      "quim@change.test",
    );
  });

  it("asks a code for the session and takes one proof at a time", async () => {
    const rosa = await accountFromBefore("rosa@change.test", "Rosa Mar");
    expect((await askToMove(rosa, "rosa.new@change.test")).status).toBe(202);
    const { code, token } = lastEmailTo("rosa.new@change.test");

    const anonymous = await request(app)
      .post("/auth/email/confirm-change")
      .send({ code });
    expect(anonymous.status).toBe(401);
    const both = await as(
      rosa,
      request(app).post("/auth/email/confirm-change").send({ code, token }),
    );
    expect(both.status).toBe(400);
    expect(both.body.code).toBe("VALIDATION");
    expect((await UserModel.findById(rosa.userId).lean())?.email).toBe(
      "rosa@change.test",
    );
  });
});
