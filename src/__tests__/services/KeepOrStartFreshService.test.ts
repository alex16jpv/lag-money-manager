jest.mock("../../shared/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import {
  KeepOrStartFreshService,
  START_FRESH_LEASE_MS,
} from "../../app/services/KeepOrStartFreshService";
import { User } from "../../domain/entities/User";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import logger from "../../shared/logger";

const USER_ID = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const NOW = new Date("2026-09-27T12:00:00.000Z");
const ASKED = new Date("2026-09-27T11:00:00.000Z");
const SESSION = { userId: USER_ID, issuedAt: ASKED.getTime() / 1000 + 5 };
const DETAILS = {
  name: "Ana",
  locale: "es" as const,
  currency: "EUR",
  timezone: "Europe/Madrid",
};

const user = (overrides: Partial<User> = {}): User =>
  new User({
    id: USER_ID,
    name: "Ana",
    email: "ana@example.com",
    ...overrides,
  });

const asked = (): User =>
  user({
    keepOrStartFresh: {
      askedAt: ASKED,
      accounts: 1,
      transactions: 3,
      startFresh: null,
    },
  });

interface Harness {
  service: KeepOrStartFreshService;
  users: Record<
    | "getById"
    | "keepEverything"
    | "chooseStartFresh"
    | "releaseStartFresh"
    | "finishStartFresh",
    jest.Mock
  >;
  invitations: Record<"withdrawAll" | "leaveAll", jest.Mock>;
  eraser: { eraseAll: jest.Mock; eraseAccount: jest.Mock };
  categories: { restoreDefaults: jest.Mock };
  calls: string[];
}

const build = (): Harness => {
  const calls: string[] = [];
  const track =
    <T>(name: string, value: T) =>
    async (): Promise<T> => {
      calls.push(name);
      return value;
    };
  const users = {
    getById: jest.fn().mockResolvedValue(asked()),
    keepEverything: jest.fn(track("keep", user())),
    chooseStartFresh: jest.fn(track("choose", asked())),
    releaseStartFresh: jest.fn(track("release", undefined)),
    finishStartFresh: jest.fn(
      track("finish", user({ ...DETAILS, dataResetAt: NOW })),
    ),
  };
  const invitations = {
    withdrawAll: jest.fn(track("withdrawAll", 0)),
    leaveAll: jest.fn(track("leaveAll", 0)),
  };
  const eraser = {
    eraseAll: jest.fn(track("eraseAll", undefined)),
    eraseAccount: jest.fn(),
  };
  const categories = { restoreDefaults: jest.fn(track("seed", [])) };
  const service = new KeepOrStartFreshService(
    users as unknown as IUserRepository,
    invitations,
    eraser,
    categories,
    () => NOW,
  );
  return { service, users, invitations, eraser, categories, calls };
};

describe("KeepOrStartFreshService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("keeps everything and closes the question", async () => {
    const { service, users, eraser } = build();

    await expect(service.keep(USER_ID, SESSION)).resolves.toMatchObject({
      id: USER_ID,
      keepOrStartFresh: null,
    });
    expect(users.keepEverything).toHaveBeenCalledWith(USER_ID, NOW);
    expect(eraser.eraseAll).not.toHaveBeenCalled();
  });

  it.each(["keep", "startFresh"] as const)(
    "answers 409 KEEP_OR_START_FRESH_CLOSED to %s when no question is open",
    async (answer) => {
      const { service, users, eraser } = build();
      users.getById.mockResolvedValue(user());

      const promise =
        answer === "keep"
          ? service.keep(USER_ID, SESSION)
          : service.startFresh(USER_ID, SESSION, DETAILS);
      await expect(promise).rejects.toMatchObject({
        statusCode: 409,
        code: "KEEP_OR_START_FRESH_CLOSED",
      });
      expect(users.chooseStartFresh).not.toHaveBeenCalled();
      expect(eraser.eraseAll).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["issued before the question", ASKED.getTime() / 1000 - 60],
    ["with no issue time", undefined],
  ])(
    "refuses a session %s: it may be the other person's, from before the reset",
    async (_label, issuedAt) => {
      const { service, users } = build();
      const stale = { userId: USER_ID, issuedAt };

      await expect(service.keep(USER_ID, stale)).rejects.toMatchObject({
        statusCode: 401,
      });
      await expect(
        service.startFresh(USER_ID, stale, DETAILS),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(users.keepEverything).not.toHaveBeenCalled();
      expect(users.chooseStartFresh).not.toHaveBeenCalled();
    },
  );

  it("answers 404 for somebody else's profile", async () => {
    const { service, users } = build();
    const other = "019576a0-d7b6-7d6d-af6a-2b7545f5ac71";

    await expect(service.keep(other, SESSION)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      service.startFresh(other, SESSION, DETAILS),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(users.getById).not.toHaveBeenCalled();
  });

  it("starts fresh in order: claim, leave Shared, erase, seed, then close", async () => {
    const { service, users, invitations, calls } = build();

    const result = await service.startFresh(USER_ID, SESSION, DETAILS);

    expect(calls).toEqual([
      "choose",
      "withdrawAll",
      "leaveAll",
      "eraseAll",
      "seed",
      "finish",
    ]);
    expect(users.chooseStartFresh).toHaveBeenCalledWith(
      USER_ID,
      DETAILS,
      NOW,
      START_FRESH_LEASE_MS,
    );
    expect(invitations.withdrawAll).toHaveBeenCalledWith(
      { userId: USER_ID, statuses: ["PENDING", "ACCEPTED"] },
      NOW,
    );
    expect(result).toMatchObject({ name: "Ana", currency: "EUR" });
  });

  it("answers 409 START_FRESH_IN_PROGRESS while another request holds the claim", async () => {
    const { service, users, eraser } = build();
    users.chooseStartFresh.mockResolvedValue(null);

    await expect(
      service.startFresh(USER_ID, SESSION, DETAILS),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "START_FRESH_IN_PROGRESS",
    });
    expect(eraser.eraseAll).not.toHaveBeenCalled();
  });

  it("frees its claim when a step fails, so sending it again finishes it", async () => {
    const { service, users, eraser } = build();
    eraser.eraseAll.mockRejectedValueOnce(new Error("database gone"));

    await expect(service.startFresh(USER_ID, SESSION, DETAILS)).rejects.toThrow(
      "database gone",
    );
    expect(users.releaseStartFresh).toHaveBeenCalledWith(USER_ID, NOW);
    expect(users.finishStartFresh).not.toHaveBeenCalled();

    await expect(
      service.startFresh(USER_ID, SESSION, DETAILS),
    ).resolves.toMatchObject({ id: USER_ID });
    expect(users.finishStartFresh).toHaveBeenCalledTimes(1);
  });

  it("still throws the step's failure, and logs it, when the claim cannot be freed", async () => {
    const { service, users, eraser } = build();
    eraser.eraseAll.mockRejectedValueOnce(new Error("database gone"));
    users.releaseStartFresh.mockRejectedValueOnce(new Error("still gone"));

    await expect(service.startFresh(USER_ID, SESSION, DETAILS)).rejects.toThrow(
      "database gone",
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "START_FRESH_NOT_RELEASED" }),
      expect.any(String),
    );
  });
});
