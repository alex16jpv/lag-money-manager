import request from "supertest";

import app from "../../app";
import { CLIENT_IP_HEADER } from "../../app/middlewares/clientIp";
import { RateLimitModel } from "../../infrastructure/models/RateLimitModel";
import { connect, disconnect, dropDatabase } from "./support";

jest.mock("../../shared/constants", () => {
  const actual = jest.requireActual("../../shared/constants");
  return {
    ...actual,
    ENVIRONMENT: {
      ...actual.ENVIRONMENT,
      API_SECRET: "lockout-gateway",
      AUTH_RATE_LIMIT_MAX: 3,
      AUTH_EMAIL_RATE_LIMIT_MAX: 6,
    },
  };
});

const fromClient = (req: request.Test, ip: string): request.Test =>
  req.set("x-api-secret", "lockout-gateway").set(CLIENT_IP_HEADER, ip);

const EMAIL = "owner@lockout.test";
const PASSWORD = "Owner!2026";
const OWNER_IP = "198.51.100.1";
const ATTACKER_IP = "203.0.113.9";

const login = (
  password: string,
  ip: string,
  deviceToken?: string,
): request.Test =>
  fromClient(request(app).post("/auth/login"), ip).send({
    email: EMAIL,
    password,
    ...(deviceToken ? { deviceToken } : {}),
  });

const registerAs = (
  email: string,
  password: string,
  ip: string,
): request.Test =>
  fromClient(request(app).post("/auth/register"), ip).send({
    name: "Someone",
    email,
    password,
    currency: "COP",
  });

const fail = async (
  times: number,
  ip: string,
  deviceToken?: string,
): Promise<void> => {
  for (let i = 0; i < times; i++) {
    const res = await login("wrong-password", ip, deviceToken);
    expect(res.status).toBe(401);
  }
};

describe("login lockout against mongod (T-176)", () => {
  let ownerDevice: string;

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    const res = await registerAs(EMAIL, PASSWORD, OWNER_IP);
    expect(res.status).toBe(201);
    expect(typeof res.body.deviceToken).toBe("string");
    ownerDevice = res.body.deviceToken;
  });

  beforeEach(async () => {
    await RateLimitModel.deleteMany({});
  });

  afterAll(async () => {
    await disconnect();
  });

  it("locks a stranger's address, not the owner", async () => {
    await fail(3, ATTACKER_IP);
    expect((await login("wrong-password", ATTACKER_IP)).status).toBe(429);
    expect((await login(PASSWORD, ATTACKER_IP)).status).toBe(429);

    expect((await login(PASSWORD, OWNER_IP)).status).toBe(200);
    expect((await login(PASSWORD, ATTACKER_IP, ownerDevice)).status).toBe(200);
  });

  it("caps an attack that rotates addresses, except on a recognized device", async () => {
    for (let i = 1; i <= 6; i++) {
      expect((await login("wrong-password", `203.0.113.${i}`)).status).toBe(
        401,
      );
    }
    expect((await login(PASSWORD, "203.0.113.50")).status).toBe(429);

    const res = await login(PASSWORD, "203.0.113.51", ownerDevice);
    expect(res.status).toBe(200);
    expect(typeof res.body.deviceToken).toBe("string");
    expect(res.body.deviceToken).not.toBe(ownerDevice);
    expect((await login(PASSWORD, OWNER_IP, res.body.deviceToken)).status).toBe(
      200,
    );
  });

  it("gives a recognized device its own budget, which only its failures spend", async () => {
    await fail(3, OWNER_IP, ownerDevice);
    expect((await login(PASSWORD, OWNER_IP, ownerDevice)).status).toBe(429);
    expect((await login(PASSWORD, "198.51.100.2")).status).toBe(200);
  });

  it("does not recognize a device token issued to another email", async () => {
    const other = await registerAs(
      "other@lockout.test",
      "Other!2026",
      ATTACKER_IP,
    );
    expect(other.status).toBe(201);
    const foreign = other.body.deviceToken as string;

    await fail(3, ATTACKER_IP, foreign);
    expect((await login(PASSWORD, ATTACKER_IP, foreign)).status).toBe(429);
    expect((await login(PASSWORD, ATTACKER_IP, "not-a-token")).status).toBe(
      429,
    );
    expect((await login(PASSWORD, ATTACKER_IP, ownerDevice)).status).toBe(200);
  });

  it("counts failed registers with the owner's email like failed logins", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await registerAs(EMAIL, "Guess!2026", ATTACKER_IP)).status).toBe(
        409,
      );
    }
    expect((await registerAs(EMAIL, "Guess!2026", ATTACKER_IP)).status).toBe(
      429,
    );
    expect((await login(PASSWORD, ATTACKER_IP)).status).toBe(429);
    expect((await login(PASSWORD, ATTACKER_IP, ownerDevice)).status).toBe(200);
  });

  it("refunds a successful login in every budget it spent", async () => {
    expect((await login(PASSWORD, ATTACKER_IP)).status).toBe(200);
    expect((await login(PASSWORD, OWNER_IP, ownerDevice)).status).toBe(200);
    const counters = await RateLimitModel.find({
      _id: { $regex: /^login-(device|email)/ },
    }).lean();
    expect(
      counters
        .map((c) => c._id.replace(/^login-device:.+$/, "login-device:*"))
        .sort(),
    ).toEqual([
      "login-device:*",
      `login-email-ip:${EMAIL}:${ATTACKER_IP}`,
      `login-email:${EMAIL}`,
    ]);
    expect(counters.every((c) => c.count === 0)).toBe(true);
  });

  it("forgets every device token after a logout-all", async () => {
    const signedIn = await login(PASSWORD, OWNER_IP, ownerDevice);
    expect(signedIn.status).toBe(200);
    const fresh = signedIn.body.deviceToken as string;
    const out = await fromClient(
      request(app).post("/auth/logout-all"),
      OWNER_IP,
    ).set("Authorization", `Bearer ${signedIn.body.accessToken}`);
    expect(out.status).toBe(200);

    await fail(3, ATTACKER_IP, ownerDevice);
    expect((await login(PASSWORD, ATTACKER_IP, ownerDevice)).status).toBe(429);
    expect((await login(PASSWORD, ATTACKER_IP, fresh)).status).toBe(429);
    expect((await login(PASSWORD, OWNER_IP)).status).toBe(200);
  });
});
