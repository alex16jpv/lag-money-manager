jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    JWT_SECRET: "test-secret-key",
    LOG_LEVEL: "info",
    NODE_ENV: "test",
  },
  ACCOUNT_LINK_TOKEN_FORMAT: /^[A-Za-z0-9_-]{64}$/,
}));

jest.mock("../../shared/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { tokenDigest } from "../../app/services/authCodes";
import { EmailOutcome } from "../../app/services/EmailService";
import { NightlyPassService } from "../../app/services/NightlyPassService";
import { User } from "../../domain/entities/User";
import logger from "../../shared/logger";
import { mockUserRepo } from "./userRepoMock";

const NOW = new Date("2026-09-28T23:27:00.000Z");
const sent: EmailOutcome = {
  status: "sent",
  provider: "mailpit",
  messageId: "m-1",
};

const user = (id: string, overrides: Partial<User> = {}): User =>
  new User({
    id,
    name: "Old",
    email: `${id}@example.com`,
    timezone: "America/Bogota",
    locale: "es",
    ...overrides,
  });

interface Harness {
  service: NightlyPassService;
  users: ReturnType<typeof mockUserRepo>;
  eraser: { eraseAccount: jest.Mock };
  email: { sendCode: jest.Mock };
  tick: (ms: number) => void;
}

const build = (
  config: { deadlines?: boolean; perNight?: number } = {},
): Harness => {
  const users = mockUserRepo();
  const eraser = { eraseAccount: jest.fn().mockResolvedValue(undefined) };
  const email = { sendCode: jest.fn().mockResolvedValue(sent) };
  let clock = 0;
  const service = new NightlyPassService(
    users,
    eraser,
    email,
    {
      deadlines: config.deadlines ?? true,
      deadlineEmailsPerNight: config.perNight ?? 100,
    },
    () => NOW,
    () => clock,
  );
  return {
    service,
    users,
    eraser,
    email,
    tick: (ms: number) => {
      clock += ms;
    },
  };
};

describe("NightlyPassService [T-238]", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("deleted accounts", () => {
    it("gives the ones deleted before T-238 their 30 days, ending where each lives", async () => {
      const h = build({ deadlines: false });
      h.users.listUndatedDeletions
        .mockResolvedValueOnce([
          user("a", { deletedAt: new Date("2026-01-01") }),
          user("b", {
            deletedAt: new Date("2026-02-01"),
            timezone: "Asia/Tokyo",
          }),
        ])
        .mockResolvedValueOnce([]);

      const report = await h.service.run(10_000);

      expect(report.dated).toBe(2);
      expect(h.users.setKeptUntil).toHaveBeenCalledWith(
        "a",
        new Date("2026-10-29T05:00:00Z"),
      );
      expect(h.users.setKeptUntil).toHaveBeenCalledWith(
        "b",
        new Date("2026-10-29T15:00:00Z"),
      );
    });

    it("erases each one past its days: claim, data, then the account", async () => {
      const h = build({ deadlines: false });
      h.users.listErasable
        .mockResolvedValueOnce(["a", "b"])
        .mockResolvedValue([]);

      const report = await h.service.run(10_000);

      expect(report.erased).toBe(2);
      expect(h.users.claimErasure).toHaveBeenCalledWith("a", NOW);
      expect(h.eraser.eraseAccount).toHaveBeenCalledWith("a");
      expect(h.users.eraseForGood).toHaveBeenCalledWith("b");
      expect(h.users.claimErasure.mock.invocationCallOrder[0]).toBeLessThan(
        h.eraser.eraseAccount.mock.invocationCallOrder[0],
      );
      expect(h.eraser.eraseAccount.mock.invocationCallOrder[0]).toBeLessThan(
        h.users.eraseForGood.mock.invocationCallOrder[0],
      );
    });

    it("erases nothing of an account restored since it was listed", async () => {
      const h = build({ deadlines: false });
      h.users.listErasable.mockResolvedValueOnce(["a"]).mockResolvedValue([]);
      h.users.claimErasure.mockResolvedValue(false);

      await expect(h.service.run(10_000)).resolves.toMatchObject({
        erased: 0,
      });
      expect(h.eraser.eraseAccount).not.toHaveBeenCalled();
      expect(h.users.eraseForGood).not.toHaveBeenCalled();
    });

    it("logs ACCOUNT_ERASE_FAILED, skips that account for the night and goes on", async () => {
      const h = build({ deadlines: false });
      h.users.listErasable
        .mockResolvedValueOnce(["a", "b"])
        .mockResolvedValue([]);
      h.eraser.eraseAccount.mockRejectedValueOnce(new Error("timeout"));

      const report = await h.service.run(10_000);

      expect(report).toMatchObject({ erased: 1, eraseFailed: 1 });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ACCOUNT_ERASE_FAILED", userId: "a" }),
        expect.any(String),
      );
      expect(h.users.listErasable).toHaveBeenLastCalledWith(NOW, 25, ["a"]);
    });

    it("logs ACCOUNT_ERASE_BACKLOG when its time runs out with accounts left", async () => {
      const h = build({ deadlines: false });
      h.users.listErasable.mockResolvedValue(["a", "b", "c"]);
      h.eraser.eraseAccount.mockImplementation(async () => h.tick(4_000));

      const report = await h.service.run(10_000);

      expect(report.erased).toBe(3);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ACCOUNT_ERASE_BACKLOG" }),
        expect.any(String),
      );
    });
  });

  describe("the deadline of the accounts from before email", () => {
    it("sends nothing while deadlines are off", async () => {
      const h = build({ deadlines: false });
      h.users.listWithoutDeadline.mockResolvedValue([user("a")]);

      await h.service.run(10_000);

      expect(h.email.sendCode).not.toHaveBeenCalled();
      expect(h.users.listWithoutDeadline).not.toHaveBeenCalled();
    });

    it("announces 14 days, to the end of the last one where it lives, with a link of its own", async () => {
      const h = build();
      h.users.listWithoutDeadline
        .mockResolvedValueOnce([user("a")])
        .mockResolvedValue([]);

      const report = await h.service.run(10_000);

      expect(report.deadlines).toBe(1);
      const request = h.email.sendCode.mock.calls[0][0];
      expect(request).toMatchObject({
        template: "confirm-deadline",
        data: { deadline: "2026-10-12" },
        recipient: { email: "a@example.com", locale: "es" },
        requester: null,
      });
      expect(h.users.startConfirmDeadline).toHaveBeenCalledWith(
        "a",
        "a@example.com",
        {
          day: "2026-10-12",
          endsAt: new Date("2026-10-13T05:00:00Z"),
          remindedAt: null,
          links: [
            {
              email: "a@example.com",
              tokenHash: tokenDigest(request.data.token),
            },
          ],
        },
      );
    });

    it("starts no deadline whose email did not go, and stops for the night on a cap or an outage", async () => {
      const h = build();
      h.users.listWithoutDeadline
        .mockResolvedValueOnce([user("a"), user("b"), user("c")])
        .mockResolvedValue([]);
      h.email.sendCode
        .mockResolvedValueOnce({ status: "failed", reason: "rejected" })
        .mockResolvedValueOnce({ status: "limited", retryAfterSeconds: 600 });

      const report = await h.service.run(10_000);

      expect(report.deadlines).toBe(0);
      expect(h.users.startConfirmDeadline).not.toHaveBeenCalled();
      expect(h.email.sendCode).toHaveBeenCalledTimes(2);
    });

    it("sends no more than its share of the night", async () => {
      const h = build({ perNight: 2 });
      h.users.listWithoutDeadline.mockResolvedValue([
        user("a"),
        user("b"),
        user("c"),
      ]);

      await expect(h.service.run(10_000)).resolves.toMatchObject({
        deadlines: 2,
      });
      expect(h.email.sendCode).toHaveBeenCalledTimes(2);
    });

    it("reminds an account four days before its deadline, once, with the days left", async () => {
      const h = build();
      const due = user("a", {
        confirmDeadline: {
          day: "2026-10-02",
          endsAt: new Date("2026-10-03T05:00:00Z"),
          remindedAt: null,
          links: [],
        },
      });
      const early = user("b", {
        confirmDeadline: {
          day: "2026-10-03",
          endsAt: new Date("2026-10-04T05:00:00Z"),
          remindedAt: null,
          links: [],
        },
      });
      h.users.listDueReminders
        .mockResolvedValueOnce([due, early])
        .mockResolvedValue([]);

      const report = await h.service.run(10_000);

      expect(report.reminders).toBe(1);
      expect(h.email.sendCode).toHaveBeenCalledWith(
        expect.objectContaining({
          template: "confirm-deadline-reminder",
          data: expect.objectContaining({
            deadline: "2026-10-02",
            daysLeft: 4,
          }),
        }),
      );
      expect(h.users.markReminded).toHaveBeenCalledWith(
        "a",
        { email: "a@example.com", tokenHash: expect.any(String) },
        NOW,
      );
      expect(h.users.listDueReminders).toHaveBeenLastCalledWith(
        NOW,
        new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000),
        25,
        ["b"],
      );
    });
  });
});
