jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    PORT: 3000,
    DB_TYPE: "MONGO",
    JWT_SECRET: "test",
    BCRYPT_SALT_ROUNDS: 12,
    JWT_EXPIRATION: "24h",
    LOG_LEVEL: "info",
    NODE_ENV: "test",
  },
  TYPES_OUTSIDE_SPENDING: ["ADJUSTMENT", "SETTLEMENT"],
  TYPES_RECORDED_ELSEWHERE: ["SETTLEMENT"],
  SETTLEMENT_PARTIES: { CONTACT: "CONTACT", GUESTS: "GUESTS" },
  GROUP_STATUSES: { OPEN: "OPEN", SETTLED: "SETTLED" },
  INVITATION_STATUSES: {
    PENDING: "PENDING",
    ACCEPTED: "ACCEPTED",
    DECLINED: "DECLINED",
    WITHDRAWN: "WITHDRAWN",
  },
  SHARED_HISTORY_REASONS: {
    SPLIT: "SPLIT",
    SPLIT_EDITED: "SPLIT_EDITED",
    AMOUNT_CHANGED: "AMOUNT_CHANGED",
    UNSPLIT: "UNSPLIT",
    PAYMENT: "PAYMENT",
    REIMPUTED: "REIMPUTED",
  },
}));

import bcryptjs from "bcryptjs";

import { UpdateUserDTO } from "../../app/dtos/UserDTO";
import { UserService } from "../../app/services/UserService";
import { User } from "../../domain/entities/User";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ApiError } from "../../shared/errors";
import { mockInvitationRepo } from "./invitationRepoMock";
import { mockUserRepo } from "./userRepoMock";

const testUserId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const NOW = new Date("2026-09-28T15:00:00Z");

const mockUser: User = new User({
  id: testUserId,
  name: "John Doe",
  email: "john@example.com",
  password: "hashedpassword",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

describe("UserService", () => {
  let service: UserService;
  let repo: jest.Mocked<IUserRepository>;
  let accountRepo: jest.Mocked<IAccountRepository>;
  let invitations: ReturnType<typeof mockInvitationRepo>;
  let verification: { status: jest.Mock };
  let emailChange: { view: jest.Mock; cancel: jest.Mock };
  let sessions: { revokeAllForUser: jest.Mock };
  let email: { sendNotice: jest.Mock };

  beforeEach(() => {
    repo = mockUserRepo();
    accountRepo = {
      countByUserId: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<IAccountRepository>;
    invitations = mockInvitationRepo();
    verification = {
      status: jest.fn().mockResolvedValue(null),
    };
    emailChange = {
      view: jest.fn().mockReturnValue(null),
      cancel: jest.fn().mockResolvedValue(undefined),
    };
    sessions = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
    email = {
      sendNotice: jest.fn().mockResolvedValue({
        status: "sent",
        provider: "mailpit",
        messageId: "m",
      }),
    };
    service = new UserService(
      repo,
      accountRepo,
      invitations,
      verification,
      emailChange,
      sessions,
      email,
      () => NOW,
    );
  });

  describe("getUserById", () => {
    it("should return user when found and is own user", async () => {
      repo.getById.mockResolvedValue(mockUser);

      const result = await service.getUserById(testUserId, testUserId);

      expect(repo.getById).toHaveBeenCalledWith(testUserId);
      expect(result.name).toBe("John Doe");
    });

    it("carries what the sheet that confirms the email needs [T-209]", async () => {
      repo.getById.mockResolvedValue(mockUser);
      const view = {
        codeLive: true,
        lastSentAt: new Date("2026-09-27T11:59:00.000Z"),
        resendAvailableAt: null,
      };
      verification.status.mockResolvedValue(view);

      const result = await service.getUserById(testUserId, testUserId);

      expect(verification.status).toHaveBeenCalledWith(mockUser);
      expect(result.emailVerified).toBe(false);
      expect(result.emailVerification).toEqual(view);
    });

    it("carries the new address that waits for its code [T-221]", async () => {
      repo.getById.mockResolvedValue(mockUser);
      const view = {
        email: "john.doe@example.org",
        expiresAt: new Date("2026-09-29T12:00:00.000Z"),
        resendAvailableAt: null,
      };
      emailChange.view.mockReturnValue(view);

      const result = await service.getUserById(testUserId, testUserId);

      expect(emailChange.view).toHaveBeenCalledWith(mockUser);
      expect(result.emailChange).toEqual(view);
    });

    it("should throw Forbidden when accessing another user", async () => {
      await expect(
        service.getUserById("019576a0-d7b6-7d6d-af6a-000000000000", testUserId),
      ).rejects.toThrow("User not found");
    });

    it("should throw NotFound when user does not exist", async () => {
      repo.getById.mockResolvedValue(null);

      await expect(service.getUserById(testUserId, testUserId)).rejects.toThrow(
        "User not found",
      );
    });
  });

  describe("updateUser", () => {
    it("should update a user and strip password from response", async () => {
      const updatedUser = new User({
        ...mockUser,
        name: "Updated Name",
      });
      repo.update.mockResolvedValue(updatedUser);

      const result = await service.updateUser(
        testUserId,
        { name: "Updated Name" },
        testUserId,
      );

      expect(repo.update).toHaveBeenCalledWith(testUserId, {
        name: "Updated Name",
      });
      expect(result.name).toBe("Updated Name");
      expect((result as UpdateUserDTO).password).toBeUndefined();
    });

    it("saves the theme and answers it, with nothing to re-authenticate [T-212]", async () => {
      const theme = { palette: "tinta", mode: "dark" } as const;
      repo.update.mockResolvedValue(new User({ ...mockUser, theme }));

      const result = await service.updateUser(
        testUserId,
        { theme },
        testUserId,
      );

      expect(repo.update).toHaveBeenCalledWith(testUserId, { theme });
      expect(result.theme).toEqual(theme);
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it("answers a null theme until one is picked [T-212]", async () => {
      repo.getById.mockResolvedValue(mockUser);

      const result = await service.getUserById(testUserId, testUserId);

      expect(result.theme).toBeNull();
    });

    it("should throw Forbidden when updating another user", async () => {
      await expect(
        service.updateUser(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          {
            name: "Test",
          },
          testUserId,
        ),
      ).rejects.toThrow("User not found");
    });

    it("should throw when id in body does not match param id", async () => {
      await expect(
        service.updateUser(
          testUserId,
          {
            id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
            name: "Test",
          },
          testUserId,
        ),
      ).rejects.toThrow(ApiError);
      await expect(
        service.updateUser(
          testUserId,
          {
            id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
            name: "Test",
          },
          testUserId,
        ),
      ).rejects.toThrow("User id does not match");
    });

    it("should hash password and bump tokenVersion on password change", async () => {
      const withHash = new User({
        ...mockUser,
        password: bcryptjs.hashSync("oldpassword", 12),
      });
      repo.getByIdWithPassword.mockResolvedValue(withHash);
      repo.updateWithTokenBump.mockResolvedValue(mockUser);

      await service.updateUser(
        testUserId,
        {
          password: "newpassword",
          currentPassword: "oldpassword",
        },
        testUserId,
      );

      // [M3] credential changes use the atomic $set + $inc(tokenVersion), so no refresh survives.
      expect(repo.update).not.toHaveBeenCalled();
      const updateArg = repo.updateWithTokenBump.mock.calls[0][1];
      expect(updateArg.password).not.toBe("newpassword");
      expect(await bcryptjs.compare("newpassword", updateArg.password!)).toBe(
        true,
      );
      // currentPassword is verification-only: never persisted.
      expect(updateArg).not.toHaveProperty("currentPassword");
      expect(updateArg).not.toHaveProperty("tokenVersion");
      expect(updateArg).not.toHaveProperty("emailVerifiedAt");
    });

    it("ends every session row, so Active sessions stops listing the devices it signed out [T-221]", async () => {
      const withHash = new User({
        ...mockUser,
        password: bcryptjs.hashSync("oldpassword", 4),
      });
      repo.getByIdWithPassword.mockResolvedValue(withHash);
      repo.updateWithTokenBump.mockResolvedValue(mockUser);

      await service.updateUser(
        testUserId,
        { password: "newpassword", currentPassword: "oldpassword" },
        testUserId,
      );

      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(testUserId);
      expect(
        sessions.revokeAllForUser.mock.invocationCallOrder[0],
      ).toBeGreaterThan(repo.updateWithTokenBump.mock.invocationCallOrder[0]);
    });

    it("tells a confirmed address its password changed, with the device that changed it [T-211]", async () => {
      const confirmed = new User({
        ...mockUser,
        emailVerifiedAt: new Date("2026-02-01"),
      });
      repo.getByIdWithPassword.mockResolvedValue(
        new User({
          ...confirmed,
          password: bcryptjs.hashSync("oldpassword", 4),
        }),
      );
      repo.updateWithTokenBump.mockResolvedValue(confirmed);

      await service.updateUser(
        testUserId,
        { password: "newpassword", currentPassword: "oldpassword" },
        testUserId,
        "Mozilla/5.0",
      );

      expect(email.sendNotice).toHaveBeenCalledWith({
        template: "password-changed",
        data: { at: expect.any(Date), userAgent: "Mozilla/5.0" },
        recipient: expect.objectContaining({
          userId: testUserId,
          email: "john@example.com",
        }),
      });
    });

    it("cancels an email change that waits, since it was asked with the old password [T-211]", async () => {
      repo.getByIdWithPassword.mockResolvedValue(
        new User({
          ...mockUser,
          password: bcryptjs.hashSync("oldpassword", 4),
        }),
      );
      repo.updateWithTokenBump.mockResolvedValue(mockUser);
      repo.update.mockResolvedValue(mockUser);

      await service.updateUser(
        testUserId,
        { password: "newpassword", currentPassword: "oldpassword" },
        testUserId,
      );
      expect(emailChange.cancel).toHaveBeenCalledWith(testUserId);
      emailChange.cancel.mockClear();

      await service.updateUser(testUserId, { name: "Juan" }, testUserId);
      expect(emailChange.cancel).not.toHaveBeenCalled();
    });

    it("tells an address that was never confirmed nothing, and sends nothing for a profile edit [T-211]", async () => {
      repo.getByIdWithPassword.mockResolvedValue(
        new User({
          ...mockUser,
          password: bcryptjs.hashSync("oldpassword", 4),
        }),
      );
      repo.updateWithTokenBump.mockResolvedValue(mockUser);
      repo.update.mockResolvedValue(mockUser);

      await service.updateUser(
        testUserId,
        { password: "newpassword", currentPassword: "oldpassword" },
        testUserId,
      );
      await service.updateUser(testUserId, { name: "Juan" }, testUserId);

      expect(email.sendNotice).not.toHaveBeenCalled();
    });

    it("leaves the sessions alone on a plain profile edit [T-221]", async () => {
      repo.update.mockResolvedValue(mockUser);

      await service.updateUser(testUserId, { name: "Juan" }, testUserId);

      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it("rejects a credential change with a wrong currentPassword [R2-08]", async () => {
      const withHash = new User({
        ...mockUser,
        password: bcryptjs.hashSync("oldpassword", 12),
      });
      repo.getByIdWithPassword.mockResolvedValue(withHash);

      await expect(
        service.updateUser(
          testUserId,
          { password: "attacker-chosen", currentPassword: "guess" },
          testUserId,
        ),
      ).rejects.toThrow("Current password is incorrect");
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe("deleteUser", () => {
    const withPassword = new User({
      ...mockUser,
      timezone: "America/Bogota",
      password: bcryptjs.hashSync("oldpassword", 4),
    });

    beforeEach(() => {
      repo.markDeleted.mockImplementation(
        async () => new User({ ...withPassword, deletedAt: NOW }),
      );
    });

    it("keeps the account 30 days, to the end of the last day where it lives [T-238]", async () => {
      repo.getByIdWithPassword.mockResolvedValue(withPassword);

      await expect(
        service.deleteUser(testUserId, testUserId, "oldpassword"),
      ).resolves.toEqual({ keptUntil: "2026-10-28" });

      expect(repo.markDeleted).toHaveBeenCalledWith(
        testUserId,
        new Date("2026-10-29T05:00:00Z"),
        {
          tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          expiresAt: new Date("2026-10-05T15:00:00Z"),
        },
        NOW,
      );
    });

    it("ends every session now", async () => {
      repo.getByIdWithPassword.mockResolvedValue(withPassword);

      await service.deleteUser(testUserId, testUserId, "oldpassword");

      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(testUserId);
    });

    it("ends what it shared and what it joined, so nobody keeps reading a deleted account", async () => {
      repo.getByIdWithPassword.mockResolvedValue(withPassword);

      await service.deleteUser(testUserId, testUserId, "oldpassword");

      expect(invitations.withdrawAll).toHaveBeenCalledWith(
        { userId: testUserId, statuses: ["PENDING", "ACCEPTED"] },
        NOW,
      );
      expect(invitations.leaveAll).toHaveBeenCalledWith(testUserId, NOW);
    });

    it("tells a confirmed address the day it is erased, with its restore link [T-238]", async () => {
      repo.getByIdWithPassword.mockResolvedValue(
        new User({ ...withPassword, emailVerifiedAt: new Date("2026-02-01") }),
      );

      await service.deleteUser(
        testUserId,
        testUserId,
        "oldpassword",
        "Mozilla/5.0",
      );

      expect(email.sendNotice).toHaveBeenCalledWith({
        template: "account-deleted",
        data: {
          at: NOW,
          userAgent: "Mozilla/5.0",
          keptUntil: "2026-10-28",
          restoreToken: expect.stringMatching(/^[A-Za-z0-9_-]{64}$/),
        },
        recipient: expect.objectContaining({ email: "john@example.com" }),
      });
      const { restoreToken } = email.sendNotice.mock.calls[0][0].data;
      const { createHash } = await import("crypto");
      expect(repo.markDeleted.mock.calls[0][2].tokenHash).toBe(
        createHash("sha256").update(restoreToken).digest("hex"),
      );
      expect(email.sendNotice.mock.invocationCallOrder[0]).toBeGreaterThan(
        repo.markDeleted.mock.invocationCallOrder[0],
      );
    });

    it("tells an address that was never confirmed nothing when its account is deleted [T-211]", async () => {
      repo.getByIdWithPassword.mockResolvedValue(withPassword);

      await service.deleteUser(testUserId, testUserId, "oldpassword");

      expect(email.sendNotice).not.toHaveBeenCalled();
    });

    it("refuses a delete whose currentPassword is wrong [T-153]", async () => {
      repo.getByIdWithPassword.mockResolvedValue(withPassword);

      await expect(
        service.deleteUser(testUserId, testUserId, "guess"),
      ).rejects.toMatchObject({
        statusCode: 401,
        code: "CURRENT_PASSWORD_INVALID",
      });
      expect(repo.markDeleted).not.toHaveBeenCalled();
      expect(invitations.withdrawAll).not.toHaveBeenCalled();
      expect(invitations.leaveAll).not.toHaveBeenCalled();
    });

    it("answers NotFound when another request deleted it first", async () => {
      repo.getByIdWithPassword.mockResolvedValue(withPassword);
      repo.markDeleted.mockResolvedValue(null);

      await expect(
        service.deleteUser(testUserId, testUserId, "oldpassword"),
      ).rejects.toThrow("User not found");
      expect(email.sendNotice).not.toHaveBeenCalled();
    });

    it("should throw Forbidden when deleting another user", async () => {
      await expect(
        service.deleteUser(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          testUserId,
          "oldpassword",
        ),
      ).rejects.toThrow("User not found");
    });

    it("should throw NotFound when user does not exist", async () => {
      repo.getByIdWithPassword.mockResolvedValue(null);

      await expect(
        service.deleteUser(testUserId, testUserId, "oldpassword"),
      ).rejects.toThrow("User not found");
    });
  });

  describe("error propagation", () => {
    it("should propagate repository error on create (update) failure", async () => {
      repo.update.mockRejectedValue(new Error("DB write failed"));

      await expect(
        service.updateUser(testUserId, { name: "New" }, testUserId),
      ).rejects.toThrow("DB write failed");
    });

    it("should propagate repository error on delete failure", async () => {
      repo.getByIdWithPassword.mockResolvedValue(
        new User({
          ...mockUser,
          password: bcryptjs.hashSync("oldpassword", 4),
        }),
      );
      repo.markDeleted.mockRejectedValue(new Error("DB delete failed"));

      await expect(
        service.deleteUser(testUserId, testUserId, "oldpassword"),
      ).rejects.toThrow("DB delete failed");
    });
  });

  describe("currency [multi-moneda etapa 1]", () => {
    it("blocks changing the currency once accounts exist", async () => {
      repo.getById.mockResolvedValue(mockUser);
      accountRepo.countByUserId.mockResolvedValue(2);

      await expect(
        service.updateUser(testUserId, { currency: "USD" }, testUserId),
      ).rejects.toThrow("Currency cannot be changed");
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("allows changing the currency while there is no data", async () => {
      repo.getById.mockResolvedValue(mockUser);
      accountRepo.countByUserId.mockResolvedValue(0);
      repo.update.mockResolvedValue(mockUser);

      await expect(
        service.updateUser(testUserId, { currency: "USD" }, testUserId),
      ).resolves.toBeDefined();
    });
  });
});
