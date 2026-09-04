import bcryptjs from "bcryptjs";

import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ENVIRONMENT } from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import {
  toUserResponse,
  UpdateUserDTO,
  UserResponseDTO,
} from "../dtos/UserDTO";

export class UserService {
  constructor(
    private repo: IUserRepository,
    private accountRepo: IAccountRepository,
  ) {}

  async getUserById(id: string, userId: string): Promise<UserResponseDTO> {
    if (id !== userId) {
      throw new ApiError("NotFound", "User not found");
    }
    const user = await this.repo.getById(id);
    if (!user) {
      throw new ApiError("NotFound", "User not found");
    }
    return toUserResponse(user);
  }

  async updateUser(
    id: string,
    dto: UpdateUserDTO,
    userId: string,
  ): Promise<UserResponseDTO> {
    if (id !== userId) {
      throw new ApiError("NotFound", "User not found");
    }
    if (dto.id && id !== dto.id) {
      throw new ApiError("BadRequest", "User id does not match");
    }

    // Mono-currency mode: the currency is a pre-data choice. No accounts
    // implies no transactions (every type requires one), so one count decides.
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

    // Credential changes (password OR email) require re-authentication and
    // revoke live refresh tokens: the email is an identity claim.
    if (dto.password || dto.email) {
      const existing = await this.repo.getByIdWithPassword(id);
      if (!existing) {
        throw new ApiError("NotFound", "User not found");
      }
      const currentOk =
        !!dto.currentPassword &&
        !!existing.password &&
        (await bcryptjs.compare(dto.currentPassword, existing.password));
      if (!currentOk) {
        throw new ApiError(
          "Unauthorized",
          "Current password is incorrect",
          "CURRENT_PASSWORD_INVALID",
        );
      }

      const { currentPassword: _ignored, ...fields } = dto;
      const securedDto = {
        ...fields,
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
      return toUserResponse(updated);
    }

    const { currentPassword: _ignored, ...fields } = dto;
    const updated = await this.repo.update(id, fields);
    return toUserResponse(updated);
  }

  async deleteUser(id: string, userId: string): Promise<void> {
    if (id !== userId) {
      throw new ApiError("NotFound", "User not found");
    }
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new ApiError("NotFound", "User not found");
    }
    return await this.repo.delete(id);
  }
}
