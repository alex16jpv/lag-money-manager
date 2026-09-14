// Rotation against a real mongod: the mocks never see `replacedBy` as the driver writes and reads it.
import jwt from "jsonwebtoken";
import request from "supertest";

import app from "../../app";
import { RefreshSessionModel } from "../../infrastructure/models/RefreshSessionModel";
import { RefreshSessionRepository } from "../../infrastructure/repositories/refreshSession/RefreshSessionRepository";
import { connect, disconnect, dropDatabase } from "./support";

const jtiOf = (token: string): string =>
  (jwt.decode(token) as { jti: string }).jti;

const refresh = async (refreshToken: string): Promise<request.Response> =>
  request(app).post("/auth/refresh").send({ refreshToken });

const logout = async (refreshToken: string): Promise<request.Response> =>
  request(app).post("/auth/logout").send({ refreshToken });

// The gap measured in production on 2026-09-11 between a lost rotation and the client's return.
const PRODUCTION_GAP_MS = 13_284_000;

async function register(email: string): Promise<string> {
  const res = await request(app)
    .post("/auth/register")
    .send({ name: "Rotator", email, password: "Offline!2026" });
  expect(res.status).toBe(201);
  return res.body.refreshToken as string;
}

beforeAll(async () => {
  await connect();
  await dropDatabase();
});

afterAll(async () => {
  await disconnect();
});

describe("refresh rotation [H-37]", () => {
  it("re-issues the same successor when the answer never reached the client", async () => {
    const first = await register("lost-answer@example.com");

    const rotated = await refresh(first);
    expect(rotated.status).toBe(200);
    const successor = rotated.body.refreshToken as string;

    // The client never saw that answer, so it asks again with the same token.
    const again = await refresh(first);
    expect(again.status).toBe(200);
    expect(jtiOf(again.body.refreshToken)).toBe(jtiOf(successor));

    // And the family is untouched: the successor still rotates.
    const third = await refresh(successor);
    expect(third.status).toBe(200);
    expect(jtiOf(third.body.refreshToken)).not.toBe(jtiOf(successor));
  });

  it("revokes the family when the successor was already used", async () => {
    const first = await register("real-replay@example.com");

    const second = (await refresh(first)).body.refreshToken as string;
    const third = (await refresh(second)).body.refreshToken as string;

    // `first` is two rotations behind: its successor is spent, so this is a replay.
    const replayed = await refresh(first);
    expect(replayed.status).toBe(401);
    expect(replayed.body.code).toBe("REFRESH_REVOKED");

    // The whole chain is dead, including the token the live client holds.
    const afterRevocation = await refresh(third);
    expect(afterRevocation.status).toBe(401);
    expect(afterRevocation.body.code).toBe("REFRESH_REVOKED");
  });

  it("re-issues hours later, ten times, and then retires only that row [T-33]", async () => {
    const first = await register("stale-rotation@example.com");
    const successor = (await refresh(first)).body.refreshToken as string;

    const realNow = Date.now;
    Date.now = () => realNow() + PRODUCTION_GAP_MS;
    let access = "";
    try {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const late = await refresh(first);
        expect(late.status).toBe(200);
        expect(jtiOf(late.body.refreshToken)).toBe(jtiOf(successor));
        access = late.body.accessToken as string;
      }
      const spent = await refresh(first);
      expect(spent.status).toBe(401);
      expect(spent.body.code).toBe("REFRESH_REVOKED");
    } finally {
      Date.now = realNow;
    }

    // The counter is the driver's, not the mock's: eleven presentations, eleven increments.
    const row = await RefreshSessionModel.findById(jtiOf(first)).lean();
    expect(row?.reissueCount).toBe(11);
    expect(row?.reissuedAt).toBeInstanceOf(Date);

    // What the owner sees is the re-issue, not the rotation it repeats.
    const listed = await request(app)
      .get("/auth/sessions")
      .set("Authorization", `Bearer ${access}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].current).toBe(true);
    expect(new Date(listed.body.data[0].lastUsedAt).getTime()).toBe(
      row?.reissuedAt?.getTime(),
    );

    // And the family was never the thief's: the successor still rotates.
    expect((await refresh(successor)).status).toBe(200);
  });

  it("does not leave a device in when a logout lands mid-rotation [H-62]", async () => {
    const first = await register("logout-mid-rotation@example.com");
    const parent = jtiOf(first);
    const family = (await RefreshSessionModel.findById(parent).lean())
      ?.familyId;

    // The interleaving itself: the logout sweeps the family between the rotation and the new row.
    const write = RefreshSessionRepository.prototype.create;
    const interleaved = jest
      .spyOn(RefreshSessionRepository.prototype, "create")
      .mockImplementation(async function (
        this: RefreshSessionRepository,
        session,
      ) {
        await RefreshSessionModel.updateMany(
          { familyId: family, revokedAt: null },
          { revokedAt: new Date() },
        );
        return write.call(this, session);
      });

    let born: string | undefined;
    try {
      const after = await refresh(first);
      expect(after.status).toBe(401);
      expect(after.body.code).toBe("REFRESH_REVOKED");
      born = interleaved.mock.calls[0]?.[0]?.jti;
    } finally {
      interleaved.mockRestore();
    }

    // The row the logout could not see, because it did not exist yet, is closed by the re-read.
    expect(born).toBeDefined();
    const row = await RefreshSessionModel.findById(born).lean();
    expect(row?.revokedAt).toBeInstanceOf(Date);

    // And the device is out for good: what it holds no longer renews.
    expect((await refresh(first)).status).toBe(401);
  });

  it("answers a revoked family without calling it theft [T-33]", async () => {
    const first = await register("after-logout@example.com");
    const successor = (await refresh(first)).body.refreshToken as string;

    expect((await logout(successor)).status).toBe(200);

    // The client that lost the answer comes back after the logout: over, but nobody replayed anything.
    const after = await refresh(first);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe("REFRESH_REVOKED");
  });
});
