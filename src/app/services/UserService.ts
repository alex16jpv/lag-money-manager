import bcryptjs from "bcryptjs";

import { User } from "../../domain/entities/User";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { ISharedInvitationRepository } from "../../domain/repositories/sharedInvitation/ISharedInvitationRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ENVIRONMENT, INVITATION_STATUSES } from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import logger from "../../shared/logger";
import {
  EmailVerificationView,
  toUserResponse,
  UpdateUserDTO,
  UserResponseDTO,
} from "../dtos/UserDTO";
import { EmailRequester } from "./EmailService";
import { EmailVerificationService } from "./EmailVerificationService";

async function assertCurrentPassword(
  user: User,
  candidate: string | undefined,
): Promise<void> {
  const ok =
    !!candidate &&
    !!user.password &&
    (await bcryptjs.compare(candidate, user.password));
  if (!ok) {
    throw new ApiError(
      "Unauthorized",
      "Current password is incorrect",
      "CURRENT_PASSWORD_INVALID",
    );
  }
}

export class UserService {
  constructor(
    private repo: IUserRepository,
    private accountRepo: IAccountRepository,
    private invitationRepo: ISharedInvitationRepository,
    private verification: Pick<EmailVerificationService, "status" | "send">,
  ) {}

  async getUserById(
    id: string,
    userId: string,
  ): Promise<
    UserResponseDTO & { emailVerification: EmailVerificationView | null }
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
    };
  }

  async updateUser(
    id: string,
    dto: UpdateUserDTO,
    userId: string,
    requester: EmailRequester,
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

    // The email is an identity claim, so changing it re-authenticates and revokes live refreshes.
    if (dto.password || dto.email) {
      const existing = await this.repo.getByIdWithPassword(id);
      if (!existing) {
        throw new ApiError("NotFound", "User not found");
      }
      await assertCurrentPassword(existing, dto.currentPassword);

      const { currentPassword: _ignored, ...fields } = dto;
      const movesEmail = !!dto.email && dto.email !== existing.email;
      const securedDto = {
        ...fields,
        // A confirmation proves the old address, never the new one.
        ...(movesEmail
          ? { emailVerifiedAt: null, emailChangedAt: new Date() }
          : {}),
        ...(dto.password
          ? {
              password: await bcryptjs.hash(
                dto.password,
                ENVIRONMENT.BCRYPT_SALT_ROUNDS,
              ),
            }
          : {}),
      };
      // Atomic bump: a concurrent logout-all must never lose a revocation.
      const updated = await this.repo.updateWithTokenBump(id, securedDto);
      if (movesEmail) await this.askToConfirm(updated, requester);
      return toUserResponse(updated);
    }

    const { currentPassword: _ignored, ...fields } = dto;
    const updated = await this.repo.update(id, fields);
    return toUserResponse(updated);
  }

  private async askToConfirm(
    user: User,
    requester: EmailRequester,
  ): Promise<void> {
    try {
      await this.verification.send(user, requester);
    } catch (err) {
      logger.error(
        { err, code: "VERIFICATION_NOT_SENT", userId: user.id },
        "The new address was saved but its confirmation code could not be sent",
      );
    }
  }

  async deleteUser(
    id: string,
    userId: string,
    currentPassword: string,
  ): Promise<void> {
    if (id !== userId) {
      throw new ApiError("NotFound", "User not found");
    }
    const existing = await this.repo.getByIdWithPassword(id);
    if (!existing) {
      throw new ApiError("NotFound", "User not found");
    }
    await assertCurrentPassword(existing, currentPassword);
    await this.repo.delete(id);
    const now = new Date();
    await this.invitationRepo.withdrawAll(
      {
        userId: id,
        statuses: [INVITATION_STATUSES.PENDING, INVITATION_STATUSES.ACCEPTED],
      },
      now,
    );
    await this.invitationRepo.leaveAll(id, now);
  }
}
