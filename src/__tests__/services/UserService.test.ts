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

jest.mock("../../shared/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import bcryptjs from "bcryptjs";

import { UpdateUserDTO } from "../../app/dtos/UserDTO";
import { UserService } from "../../app/services/UserService";
import { User } from "../../domain/entities/User";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ApiError } from "../../shared/errors";
import logger from "../../shared/logger";
import { mockInvitationRepo } from "./invitationRepoMock";

const testUserId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const REQUESTER = { ip: "203.0.113.7", recognizedDevice: null };

const mockUser: User = new User({
  id: testUserId,
  name: "John Doe",
  email: "john@example.com",
  password: "hashedpassword",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

const createMockRepo = (): jest.Mocked<IUserRepository> => ({
  getManyByIds: jest.fn().mockResolvedValue([]),
  getAll: jest.fn(),
  getById: jest.fn(),
  getByEmail: jest.fn(),
  getDeletedByEmail: jest.fn().mockResolvedValue(null),
  markEmailVerified: jest.fn(),
  getForErasure: jest.fn().mockResolvedValue(null),
  claimErasure: jest.fn().mockResolvedValue(null),
  eraseForGood: jest.fn().mockResolvedValue(undefined),
  getByIdWithPassword: jest.fn().mockResolvedValue(null),
  bumpTokenVersion: jest.fn().mockResolvedValue(undefined),
  updateWithTokenBump: jest.fn(),
  recordLogin: jest.fn().mockResolvedValue(undefined),
  reactivate: jest.fn(),
  resetPassword: jest.fn(),
  keepEverything: jest.fn(),
  chooseStartFresh: jest.fn(),
  finishStartFresh: jest.fn(),
  releaseStartFresh: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

describe("UserService", () => {
  let service: UserService;
  let repo: jest.Mocked<IUserRepository>;
  let accountRepo: jest.Mocked<IAccountRepository>;
  let invitations: ReturnType<typeof mockInvitationRepo>;
  let verification: { status: jest.Mock; send: jest.Mock };

  beforeEach(() => {
    repo = createMockRepo();
    accountRepo = {
      countByUserId: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<IAccountRepository>;
    invitations = mockInvitationRepo();
    verification = {
      status: jest.fn().mockResolvedValue(null),
      send: jest.fn().mockResolvedValue({ status: "sent" }),
    };
    service = new UserService(repo, accountRepo, invitations, verification);
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
        REQUESTER,
      );

      expect(repo.update).toHaveBeenCalledWith(testUserId, {
        name: "Updated Name",
      });
      expect(result.name).toBe("Updated Name");
      expect((result as UpdateUserDTO).password).toBeUndefined();
    });

    it("should throw Forbidden when updating another user", async () => {
      await expect(
        service.updateUser(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          {
            name: "Test",
          },
          testUserId,
          REQUESTER,
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
          REQUESTER,
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
          REQUESTER,
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
        REQUESTER,
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
    });

    it("drops the email's confirmation when the email changes, and only then [T-207]", async () => {
      const withHash = new User({
        ...mockUser,
        password: bcryptjs.hashSync("oldpassword", 4),
        emailVerifiedAt: new Date("2026-09-01T00:00:00.000Z"),
      });
      repo.getByIdWithPassword.mockResolvedValue(withHash);
      repo.updateWithTokenBump.mockResolvedValue(mockUser);

      await service.updateUser(
        testUserId,
        { email: "other@example.com", currentPassword: "oldpassword" },
        testUserId,
        REQUESTER,
      );
      await service.updateUser(
        testUserId,
        { email: withHash.email, currentPassword: "oldpassword" },
        testUserId,
        REQUESTER,
      );
      await service.updateUser(
        testUserId,
        { password: "newpassword", currentPassword: "oldpassword" },
        testUserId,
        REQUESTER,
      );

      const [moved, same, password] = repo.updateWithTokenBump.mock.calls.map(
        (call) => call[1],
      );
      expect(moved).toMatchObject({ emailVerifiedAt: null });
      expect(same).not.toHaveProperty("emailVerifiedAt");
      expect(password).not.toHaveProperty("emailVerifiedAt");
    });

    it("asks the new address to confirm itself, and only a new address [T-209]", async () => {
      const withHash = new User({
        ...mockUser,
        password: bcryptjs.hashSync("oldpassword", 4),
      });
      const moved = new User({ ...mockUser, email: "other@example.com" });
      repo.getByIdWithPassword.mockResolvedValue(withHash);
      repo.updateWithTokenBump.mockResolvedValue(moved);

      await service.updateUser(
        testUserId,
        { email: "other@example.com", currentPassword: "oldpassword" },
        testUserId,
        REQUESTER,
      );
      await service.updateUser(
        testUserId,
        { email: withHash.email, currentPassword: "oldpassword" },
        testUserId,
        REQUESTER,
      );
      await service.updateUser(
        testUserId,
        { password: "newpassword", currentPassword: "oldpassword" },
        testUserId,
        REQUESTER,
      );

      expect(verification.send).toHaveBeenCalledTimes(1);
      expect(verification.send).toHaveBeenCalledWith(moved, REQUESTER);
    });

    it("keeps the new address when its code could not be sent [T-209]", async () => {
      repo.getByIdWithPassword.mockResolvedValue(
        new User({
          ...mockUser,
          password: bcryptjs.hashSync("oldpassword", 4),
        }),
      );
      repo.updateWithTokenBump.mockResolvedValue(
        new User({ ...mockUser, email: "other@example.com" }),
      );
      verification.send.mockRejectedValue(new Error("mongo down"));

      const result = await service.updateUser(
        testUserId,
        { email: "other@example.com", currentPassword: "oldpassword" },
        testUserId,
        REQUESTER,
      );

      expect(result.email).toBe("other@example.com");
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ code: "VERIFICATION_NOT_SENT" }),
        expect.any(String),
      );
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
          { email: "attacker@evil.com", currentPassword: "guess" },
          testUserId,
          REQUESTER,
        ),
      ).rejects.toThrow("Current password is incorrect");
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe("deleteUser", () => {
    const withPassword = new User({
      ...mockUser,
      password: bcryptjs.hashSync("oldpassword", 4),
    });

    it("should delete the authenticated user", async () => {
      repo.getByIdWithPassword.mockResolvedValue(withPassword);
      repo.delete.mockResolvedValue();

      await service.deleteUser(testUserId, testUserId, "oldpassword");

      expect(repo.getByIdWithPassword).toHaveBeenCalledWith(testUserId);
      expect(repo.delete).toHaveBeenCalledWith(testUserId);
    });

    it("ends what it shared and what it joined, so nobody keeps reading a deleted account", async () => {
      repo.getByIdWithPassword.mockResolvedValue(withPassword);
      repo.delete.mockResolvedValue();

      await service.deleteUser(testUserId, testUserId, "oldpassword");

      expect(invitations.withdrawAll).toHaveBeenCalledWith(
        { userId: testUserId, statuses: ["PENDING", "ACCEPTED"] },
        expect.any(Date),
      );
      expect(invitations.leaveAll).toHaveBeenCalledWith(
        testUserId,
        expect.any(Date),
      );
    });

    it("refuses a delete whose currentPassword is wrong [T-153]", async () => {
      repo.getByIdWithPassword.mockResolvedValue(withPassword);

      await expect(
        service.deleteUser(testUserId, testUserId, "guess"),
      ).rejects.toMatchObject({
        statusCode: 401,
        code: "CURRENT_PASSWORD_INVALID",
      });
      expect(repo.delete).not.toHaveBeenCalled();
      expect(invitations.withdrawAll).not.toHaveBeenCalled();
      expect(invitations.leaveAll).not.toHaveBeenCalled();
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
        service.updateUser(testUserId, { name: "New" }, testUserId, REQUESTER),
      ).rejects.toThrow("DB write failed");
    });

    it("should propagate repository error on delete failure", async () => {
      repo.getByIdWithPassword.mockResolvedValue(
        new User({
          ...mockUser,
          password: bcryptjs.hashSync("oldpassword", 4),
        }),
      );
      repo.delete.mockRejectedValue(new Error("DB delete failed"));

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
        service.updateUser(
          testUserId,
          { currency: "USD" },
          testUserId,
          REQUESTER,
        ),
      ).rejects.toThrow("Currency cannot be changed");
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("allows changing the currency while there is no data", async () => {
      repo.getById.mockResolvedValue(mockUser);
      accountRepo.countByUserId.mockResolvedValue(0);
      repo.update.mockResolvedValue(mockUser);

      await expect(
        service.updateUser(
          testUserId,
          { currency: "USD" },
          testUserId,
          REQUESTER,
        ),
      ).resolves.toBeDefined();
    });
  });
});
