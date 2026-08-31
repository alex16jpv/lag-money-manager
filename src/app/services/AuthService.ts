import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import { v7 as uuidv7 } from "uuid";

import { User } from "../../domain/entities/User";
import { IRefreshSessionRepository } from "../../domain/repositories/refreshSession/IRefreshSessionRepository";
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

interface RefreshPayload {
  userId: string;
  tokenVersion: number;
  jti: string;
}

export class AuthService {
  constructor(
    private repo: IUserRepository,
    private categoryService: CategoryService,
    private sessions: IRefreshSessionRepository,
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

  private signAccessToken(user: User): string {
    return jwt.sign(
      { userId: user.id, email: user.email, timezone: user.timezone },
      ENVIRONMENT.JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: ENVIRONMENT.JWT_EXPIRATION as jwt.SignOptions["expiresIn"],
      },
    );
  }

  private signRefreshToken(
    user: User,
    jti: string,
    expiresInSeconds?: number,
  ): string {
    return jwt.sign(
      {
        userId: user.id,
        tokenVersion: user.tokenVersion,
        type: REFRESH_TOKEN_TYPE,
        jti,
      },
      ENVIRONMENT.REFRESH_SECRET ?? ENVIRONMENT.JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: (expiresInSeconds ??
          ENVIRONMENT.REFRESH_TOKEN_EXPIRATION) as jwt.SignOptions["expiresIn"],
      },
    );
  }

  // Login path: opens a new session family with the full refresh lifetime.
  private async openSession(
    user: User,
    userAgent?: string,
  ): Promise<AuthTokens> {
    const jti = uuidv7();
    const refreshToken = this.signRefreshToken(user, jti);
    const { exp } = jwt.decode(refreshToken) as { exp: number };
    await this.sessions.create({
      jti,
      userId: user.id,
      familyId: jti,
      expiresAt: new Date(exp * 1000),
      userAgent,
    });
    return { accessToken: this.signAccessToken(user), refreshToken };
  }

  // Registers and opens a session in one step: the request just proved
  // possession of the brand-new password, a follow-up login adds nothing.
  async register(
    dto: CreateUserDTO,
    userAgent?: string,
  ): Promise<AuthTokens & { user: UserResponseDTO }> {
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
        const tokens = await this.openSession(reactivated, userAgent);
        return {
          ...tokens,
          user: { ...this.toResponseDTO(reactivated), reactivated: true },
        };
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

    const tokens = await this.openSession(created, userAgent);
    return { ...tokens, user: this.toResponseDTO(created) };
  }

  async login(
    email: string,
    password: string,
    userAgent?: string,
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

    const tokens = await this.openSession(user, userAgent);
    return { ...tokens, user: this.toResponseDTO(user) };
  }

  private verifyRefreshToken(refreshToken: string): RefreshPayload {
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
      typeof (payload as { tokenVersion?: unknown }).tokenVersion !== "number" ||
      typeof (payload as { jti?: unknown }).jti !== "string"
    ) {
      throw new ApiError("Unauthorized", "Invalid refresh token", "REFRESH_INVALID");
    }

    return payload as unknown as RefreshPayload;
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const { userId, tokenVersion, jti } = this.verifyRefreshToken(refreshToken);

    const user = await this.repo.getById(userId);
    if (!user) {
      throw new ApiError("Unauthorized", "Invalid refresh token", "REFRESH_INVALID");
    }
    if (user.tokenVersion !== tokenVersion) {
      throw new ApiError("Unauthorized", "Refresh token has been revoked", "REFRESH_REVOKED");
    }

    const newJti = uuidv7();
    const session = await this.sessions.rotate(jti, newJti);
    if (!session) {
      const stale = await this.sessions.findById(jti);
      if (stale) {
        // Reuse of a rotated/revoked token: someone replayed an old refresh
        // (theft or a duplicated client). Kill the whole chain.
        await this.sessions.revokeFamily(stale.familyId);
        logger.warn(
          { userId, familyId: stale.familyId },
          "Refresh token reuse detected; family revoked",
        );
        throw new ApiError("Unauthorized", "Refresh token has been revoked", "REFRESH_REVOKED");
      }
      throw new ApiError("Unauthorized", "Invalid or expired refresh token", "REFRESH_INVALID");
    }

    // Absolute cap: rotation never extends the family past its original expiry.
    const remainingSeconds = Math.floor(
      (session.expiresAt.getTime() - Date.now()) / 1000,
    );
    if (remainingSeconds <= 0) {
      throw new ApiError("Unauthorized", "Invalid or expired refresh token", "REFRESH_INVALID");
    }

    await this.sessions.create({
      jti: newJti,
      userId: user.id,
      familyId: session.familyId,
      expiresAt: session.expiresAt,
    });

    return {
      accessToken: this.signAccessToken(user),
      refreshToken: this.signRefreshToken(user, newJti, remainingSeconds),
    };
  }

  // Per-device logout: revokes the presented token's whole rotation family.
  async logout(refreshToken: string): Promise<void> {
    const { jti } = this.verifyRefreshToken(refreshToken);
    const session = await this.sessions.findById(jti);
    if (session) {
      await this.sessions.revokeFamily(session.familyId);
    }
  }

  // Global logout: kills every refresh token (version mismatch) and marks
  // the session records revoked for bookkeeping.
  async logoutAll(userId: string): Promise<void> {
    await this.repo.bumpTokenVersion(userId);
    await this.sessions.revokeAllForUser(userId);
  }
}
