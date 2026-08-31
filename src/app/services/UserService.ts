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

    if (dto.password) {
      const existing = await this.repo.getById(id);
      if (!existing) {
        throw new ApiError("NotFound", "User not found");
      }
      const hashedDto = {
        ...dto,
        password: await bcryptjs.hash(
          dto.password,
          ENVIRONMENT.BCRYPT_SALT_ROUNDS,
        ),
        // Bump tokenVersion so every refresh token issued before this password
        // change stops working (a stolen token can no longer be renewed).
        tokenVersion: existing.tokenVersion + 1,
      };
      const updated = await this.repo.update(id, hashedDto);
      return this.toResponseDTO(updated);
    }

    const updated = await this.repo.update(id, dto);
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
