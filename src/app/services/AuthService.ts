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
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * Issues a short-lived access token (used on every request) and a long-lived
   * refresh token (used only at /auth/refresh). The refresh token carries the
   * user's tokenVersion; bumping it (on password change / logout-all) makes
   * every outstanding refresh token stop working.
   */
  private issueTokens(user: User): AuthTokens {
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      ENVIRONMENT.JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: ENVIRONMENT.JWT_EXPIRATION as jwt.SignOptions["expiresIn"],
      },
    );
    const refreshToken = jwt.sign(
      { userId: user.id, tokenVersion: user.tokenVersion, type: REFRESH_TOKEN_TYPE },
      ENVIRONMENT.JWT_SECRET,
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
      payload = jwt.verify(refreshToken, ENVIRONMENT.JWT_SECRET, {
        algorithms: ["HS256"],
      });
    } catch {
      throw new ApiError("Unauthorized", "Invalid or expired refresh token");
    }

    if (
      typeof payload !== "object" ||
      payload === null ||
      (payload as { type?: unknown }).type !== REFRESH_TOKEN_TYPE ||
      typeof (payload as { userId?: unknown }).userId !== "string"
    ) {
      throw new ApiError("Unauthorized", "Invalid refresh token");
    }

    const { userId, tokenVersion } = payload as {
      userId: string;
      tokenVersion?: number;
    };

    const user = await this.repo.getById(userId);
    if (!user) {
      throw new ApiError("Unauthorized", "Invalid refresh token");
    }
    // A bumped tokenVersion (password change / logout-all) revokes every
    // refresh token issued before it.
    if (user.tokenVersion !== (tokenVersion ?? 0)) {
      throw new ApiError("Unauthorized", "Refresh token has been revoked");
    }

    // Rotate: hand back a fresh refresh token alongside the new access token.
    return this.issueTokens(user);
  }
}
