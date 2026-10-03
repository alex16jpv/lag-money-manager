import bcryptjs from "bcryptjs";

import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { IRefreshSessionRepository } from "../../domain/repositories/refreshSession/IRefreshSessionRepository";
import { ISharedInvitationRepository } from "../../domain/repositories/sharedInvitation/ISharedInvitationRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ENVIRONMENT, INVITATION_STATUSES } from "../../shared/constants";
import { lastDayKeyOf } from "../../shared/dayKey";
import { ApiError } from "../../shared/errors";
import {
  EmailChangeView,
  EmailVerificationView,
  toUserResponse,
  UpdateUserDTO,
  UserResponseDTO,
} from "../dtos/UserDTO";
import {
  newAccountLinkToken,
  RESTORE_LINK_LIFETIME_MS,
  tokenDigest,
} from "./authCodes";
import { assertCurrentPassword } from "./currentPassword";
import { keptUntilFrom } from "./deletedAccount";
import { EmailChangeService } from "./EmailChangeService";
import { EmailService } from "./EmailService";
import { EmailVerificationService } from "./EmailVerificationService";
import { sendSecurityNotice } from "./securityNotice";

export class UserService {
  constructor(
    private repo: IUserRepository,
    private accountRepo: IAccountRepository,
    private invitationRepo: ISharedInvitationRepository,
    private verification: Pick<EmailVerificationService, "status">,
    private emailChange: Pick<EmailChangeService, "view" | "cancel">,
    private sessions: Pick<IRefreshSessionRepository, "revokeAllForUser">,
    private email: Pick<EmailService, "sendNotice">,
    private now: () => Date = () => new Date(),
  ) {}

  async getUserById(
    id: string,
    userId: string,
  ): Promise<
    UserResponseDTO & {
      emailVerification: EmailVerificationView | null;
      emailChange: EmailChangeView | null;
    }
  > {
    if (id !== userId) {
      throw new ApiError("NotFound", "User not found");
    }
    const user = await this.repo.getById(id);
    if (!user) {
      throw new ApiError("NotFound", "User not found");
    }
    return {
      ...toUserResponse(user),
      emailVerification: await this.verification.status(user),
      emailChange: this.emailChange.view(user),
    };
  }

  async updateUser(
    id: string,
    dto: UpdateUserDTO,
    userId: string,
    userAgent?: string,
  ): Promise<UserResponseDTO> {
    if (id !== userId) {
      throw new ApiError("NotFound", "User not found");
    }
    if (dto.id && id !== dto.id) {
      throw new ApiError("BadRequest", "User id does not match");
    }

    // No accounts implies no transactions (every type needs one), so one count decides.
    if (dto.currency !== undefined) {
      const existing = await this.repo.getById(id);
      if (!existing) {
        throw new ApiError("NotFound", "User not found");
      }
      if (
        dto.currency !== existing.currency &&
        (await this.accountRepo.countByUserId(id)) > 0
      ) {
        throw new ApiError(
          "BadRequest",
          "Currency cannot be changed once accounts exist; multi-currency support will handle this",
          "CURRENCY_LOCKED",
        );
      }
    }

    if (dto.password) {
      const existing = await this.repo.getByIdWithPassword(id);
      if (!existing) {
        throw new ApiError("NotFound", "User not found");
      }
      await assertCurrentPassword(existing, dto.currentPassword);

      const { currentPassword: _ignored, ...fields } = dto;
      // Atomic bump: a concurrent logout-all must never lose a revocation.
      const updated = await this.repo.updateWithTokenBump(id, {
        ...fields,
        password: await bcryptjs.hash(
          dto.password,
          ENVIRONMENT.BCRYPT_SALT_ROUNDS,
        ),
      });
      await this.sessions.revokeAllForUser(id);
      await this.emailChange.cancel(id);
      await sendSecurityNotice(this.email, updated, "password-changed", {
        at: new Date(),
        userAgent,
      });
      return toUserResponse(updated);
    }

    const { currentPassword: _ignored, ...fields } = dto;
    const updated = await this.repo.update(id, fields);
    return toUserResponse(updated);
  }

  // Kept 30 days and then erased by the nightly pass (decision 19); keptUntil is its last day where the account lives.
  async deleteUser(
    id: string,
    userId: string,
    currentPassword: string,
    userAgent?: string,
  ): Promise<{ keptUntil: string }> {
    if (id !== userId) {
      throw new ApiError("NotFound", "User not found");
    }
    const existing = await this.repo.getByIdWithPassword(id);
    if (!existing) {
      throw new ApiError("NotFound", "User not found");
    }
    await assertCurrentPassword(existing, currentPassword);
    const now = this.now();
    const keptUntil = keptUntilFrom(now, existing.timezone);
    const restoreToken = newAccountLinkToken(id);
    const deleted = await this.repo.markDeleted(
      id,
      keptUntil,
      {
        tokenHash: tokenDigest(restoreToken),
        expiresAt: new Date(now.getTime() + RESTORE_LINK_LIFETIME_MS),
      },
      now,
    );
    if (!deleted) {
      throw new ApiError("NotFound", "User not found");
    }
    await this.sessions.revokeAllForUser(id);
    await this.invitationRepo.withdrawAll(
      {
        userId: id,
        statuses: [INVITATION_STATUSES.PENDING, INVITATION_STATUSES.ACCEPTED],
      },
      now,
    );
    await this.invitationRepo.leaveAll(id, now);
    const lastDay = lastDayKeyOf(keptUntil, existing.timezone);
    await sendSecurityNotice(this.email, existing, "account-deleted", {
      at: now,
      userAgent,
      keptUntil: lastDay,
      restoreToken,
    });
    return { keptUntil: lastDay };
  }
}
