import request from "supertest";

import app from "../../app";
import { RateLimitModel } from "../../infrastructure/models/RateLimitModel";
import { connect, disconnect, dropDatabase } from "./support";

const EMAIL = "ana@reactivation.test";
const PASSWORD = "Offline!2026";

const register = (password: string, name = "Ana") =>
  request(app)
    .post("/auth/register")
    .send({ name, email: EMAIL, password, currency: "COP" });

const guesses = async (key: string) =>
  (await RateLimitModel.findById(key).lean())?.count ?? 0;
const failedAttempts = () => guesses(`login-email:${EMAIL}`);

describe("account delete and reactivation against mongod", () => {
  let token: string;
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    const res = await register(PASSWORD);
    expect(res.status).toBe(201);
    token = res.body.accessToken;
    userId = res.body.user.id;
    const account = await request(app)
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Wallet", type: "CASH", balance: 5000 });
    expect(account.status).toBe(201);
    accountId = account.body.id;
  });

  afterAll(async () => {
    await disconnect();
  });

  const remove = (body: object) =>
    request(app)
      .delete(`/users/${userId}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  it("refuses a delete without the password, or with a wrong one", async () => {
    const missing = await remove({});
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("VALIDATION");

    const wrong = await remove({ currentPassword: "guess" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("CURRENT_PASSWORD_INVALID");
    expect(await guesses(`current-password:${userId}`)).toBe(1);

    const alive = await request(app)
      .get(`/users/${userId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(alive.status).toBe(200);
  });

  it("answers a live account's email with EMAIL_TAKEN", async () => {
    const res = await register("Another!2026", "Mallory");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_TAKEN");
  });

  it("gives a deleted account back only with the password it had", async () => {
    const deleted = await remove({ currentPassword: PASSWORD });
    expect(deleted.status).toBe(200);
    expect(await guesses(`current-password:${userId}`)).toBe(1);

    const before = await failedAttempts();
    const stranger = await register("Another!2026", "Mallory");
    expect(stranger.status).toBe(409);
    expect(stranger.body.code).toBe("EMAIL_TAKEN");
    expect(await failedAttempts()).toBe(before + 1);

    const owner = await register(PASSWORD, "Ana Again");
    expect(owner.status).toBe(201);
    expect(owner.body.user.id).toBe(userId);
    expect(owner.body.user.reactivated).toBe(true);
    expect(await failedAttempts()).toBe(before + 1);

    const account = await request(app)
      .get(`/accounts/${accountId}`)
      .set("Authorization", `Bearer ${owner.body.accessToken}`);
    expect(account.status).toBe(200);
    expect(account.body.name).toBe("Wallet");
  });
});
