import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";

import { User } from "../../domain/entities/User";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ENVIRONMENT } from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import logger from "../../shared/logger";
import { CreateUserDTO, UserResponseDTO } from "../dtos/UserDTO";
import { CategoryService } from "./CategoryService";

const REFRESH_TOKEN_TYPE = "refresh";

// Real cost-12 hash of a throwaway string: login pays the same bcrypt time
// whether the email exists or not (no user enumeration by timing).
const TIMING_EQUALIZATION_HASH =
  "$2b$12$Iwrm4m9Z9FVuf94Eb.bBj.ONOMDcldf0LrANU7WTaaM8xNB4k95W.";

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  constructor(
    private repo: IUserRepository,
    private categoryService: CategoryService,
  ) {}

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

  private issueTokens(user: User): AuthTokens {
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, timezone: user.timezone },
      ENVIRONMENT.JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: ENVIRONMENT.JWT_EXPIRATION as jwt.SignOptions["expiresIn"],
      },
    );
    const refreshToken = jwt.sign(
      { userId: user.id, tokenVersion: user.tokenVersion, type: REFRESH_TOKEN_TYPE },
      ENVIRONMENT.REFRESH_SECRET ?? ENVIRONMENT.JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: ENVIRONMENT.REFRESH_TOKEN_EXPIRATION as jwt.SignOptions["expiresIn"],
      },
    );
    return { accessToken, refreshToken };
  }

  async register(dto: CreateUserDTO): Promise<UserResponseDTO> {
    const hashedPassword = await bcryptjs.hash(
      dto.password,
      ENVIRONMENT.BCRYPT_SALT_ROUNDS,
    );

    // Owner decision (R2-09): registering with a soft-deleted email reactivates
    // that account, keeping its financial history (categories included).
    const deleted = await this.repo.getDeletedByEmail(dto.email);
    if (deleted) {
      try {
        const reactivated = await this.repo.reactivate(deleted.id, {
          name: dto.name,
          password: hashedPassword,
          ...(dto.timezone ? { timezone: dto.timezone } : {}),
        });
        return { ...this.toResponseDTO(reactivated), reactivated: true };
      } catch (err) {
        // Concurrent register already reactivated it: surface as a conflict.
        if (err instanceof ApiError && err.statusCode === 404) {
          throw new ApiError("Conflict", "Email is already registered", "EMAIL_TAKEN");
        }
        throw err;
      }
    }

    const user = new User({ ...dto, password: hashedPassword });

    const created = await this.repo.create(user);

    try {
      await this.categoryService.seedDefaultCategories(created.id);
    } catch (error) {
      logger.error(
        { error, userId: created.id },
        "Failed to seed default categories",
      );
    }

    return this.toResponseDTO(created);
  }

  async login(
    email: string,
    password: string,
  ): Promise<AuthTokens & { user: UserResponseDTO }> {
    const user = await this.repo.getByEmail(email);
    if (!user || !user.password) {
      await bcryptjs.compare(password, TIMING_EQUALIZATION_HASH);
      throw new ApiError("Unauthorized", "Invalid email or password");
    }

    const isValidPassword = await bcryptjs.compare(password, user.password);
    if (!isValidPassword) {
      throw new ApiError("Unauthorized", "Invalid email or password");
    }

    return { ...this.issueTokens(user), user: this.toResponseDTO(user) };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: unknown;
    try {
      payload = jwt.verify(
        refreshToken,
        ENVIRONMENT.REFRESH_SECRET ?? ENVIRONMENT.JWT_SECRET,
        { algorithms: ["HS256"] },
      );
    } catch {
      throw new ApiError("Unauthorized", "Invalid or expired refresh token", "REFRESH_INVALID");
    }

    if (
      typeof payload !== "object" ||
      payload === null ||
      (payload as { type?: unknown }).type !== REFRESH_TOKEN_TYPE ||
      typeof (payload as { userId?: unknown }).userId !== "string" ||
      typeof (payload as { tokenVersion?: unknown }).tokenVersion !== "number"
    ) {
      throw new ApiError("Unauthorized", "Invalid refresh token", "REFRESH_INVALID");
    }

    const { userId, tokenVersion } = payload as {
      userId: string;
      tokenVersion: number;
    };

    const user = await this.repo.getById(userId);
    if (!user) {
      throw new ApiError("Unauthorized", "Invalid refresh token", "REFRESH_INVALID");
    }
    if (user.tokenVersion !== tokenVersion) {
      throw new ApiError("Unauthorized", "Refresh token has been revoked", "REFRESH_REVOKED");
    }

    return this.issueTokens(user);
  }
}
