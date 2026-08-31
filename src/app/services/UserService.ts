import bcryptjs from "bcryptjs";

import { User } from "../../domain/entities/User";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ENVIRONMENT } from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import { UpdateUserDTO, UserResponseDTO } from "../dtos/UserDTO";

export class UserService {
  constructor(private repo: IUserRepository) {}

  private toResponseDTO(user: User): UserResponseDTO {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      timezone: user.timezone,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async getUserById(id: string, userId: string): Promise<UserResponseDTO> {
    if (id !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }
    const user = await this.repo.getById(id);
    if (!user) {
      throw new ApiError("NotFound", "User not found");
    }
    return this.toResponseDTO(user);
  }

  async updateUser(
    id: string,
    dto: UpdateUserDTO,
    userId: string,
  ): Promise<UserResponseDTO> {
    if (id !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }
    if (dto.id && id !== dto.id) {
      throw new ApiError("BadRequest", "User id does not match");
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
        tokenVersion: existing.tokenVersion + 1,
      };
      const updated = await this.repo.update(id, securedDto);
      return this.toResponseDTO(updated);
    }

    const { currentPassword: _ignored, ...fields } = dto;
    const updated = await this.repo.update(id, fields);
    return this.toResponseDTO(updated);
  }

  async deleteUser(id: string, userId: string): Promise<void> {
    if (id !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new ApiError("NotFound", "User not found");
    }
    return await this.repo.delete(id);
  }
}
