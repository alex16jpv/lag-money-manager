/**
 * Refresh rotation against a real mongod (H-37): what the mocked suite cannot
 * see, because the grace window depends on `lastUsedAt` and `replacedBy` as the
 * driver actually writes and reads them back.
 */
import jwt from "jsonwebtoken";
import request from "supertest";

import app from "../../app";
import { connect, disconnect, dropDatabase } from "./support";

const jtiOf = (token: string): string =>
  (jwt.decode(token) as { jti: string }).jti;

const refresh = async (refreshToken: string): Promise<request.Response> =>
  request(app).post("/auth/refresh").send({ refreshToken });

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

  it("revokes the family when the rotation is older than the grace window", async () => {
    const first = await register("stale-rotation@example.com");
    await refresh(first);

    // Sixty-one seconds on, that token is no longer the answer that was lost; only the clock moved.
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      const late = await refresh(first);
      expect(late.status).toBe(401);
      expect(late.body.code).toBe("REFRESH_REVOKED");
    } finally {
      Date.now = realNow;
    }
  });
});
