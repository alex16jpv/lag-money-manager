import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import { v7 as uuidv7 } from "uuid";

import { User } from "../../domain/entities/User";
import {
  IRefreshSessionRepository,
  RefreshSession,
} from "../../domain/repositories/refreshSession/IRefreshSessionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ENVIRONMENT } from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import logger from "../../shared/logger";
import { SessionView } from "../dtos/SessionDTO";
import {
  CreateUserDTO,
  toUserResponse,
  UserResponseDTO,
} from "../dtos/UserDTO";
import { CategoryService } from "./CategoryService";
import { readDeviceToken, signDeviceToken } from "./deviceToken";

type LostAnswer =
  | { kind: "reissued"; tokens: AuthTokens; count: number }
  | { kind: "spent" }
  | { kind: "replay" };

const emailTaken = () =>
  new ApiError("Conflict", "Email is already registered", "EMAIL_TAKEN");

function isDuplicateEmailError(err: unknown): boolean {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  return e?.code === 11000 && !!e.keyPattern && "email" in e.keyPattern;
}

const REFRESH_TOKEN_TYPE = "refresh";

// The rotated row is an alias of its successor until someone uses it: ten pairs is alias enough.
const REFRESH_REISSUE_LIMIT = 10;

// A real cost-12 hash: login pays the same bcrypt time whether the email exists or not.
const TIMING_EQUALIZATION_HASH =
  "$2b$12$Iwrm4m9Z9FVuf94Eb.bBj.ONOMDcldf0LrANU7WTaaM8xNB4k95W.";

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface OpenedSession extends AuthTokens {
  deviceToken: string;
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

  // `sid` is the refresh family, so the sessions list marks the caller's device with no DB lookup.
  private signAccessToken(user: User, familyId: string): string {
    return jwt.sign(
      {
        userId: user.id,
        email: user.email,
        timezone: user.timezone,
        sid: familyId,
      },
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
  ): Promise<OpenedSession> {
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
    await this.repo.recordLogin(user.id);
    return {
      accessToken: this.signAccessToken(user, jti),
      refreshToken,
      deviceToken: signDeviceToken(user.email, user.tokenVersion),
    };
  }

  // The request just proved possession of the new password, so a follow-up login adds nothing.
  async register(
    dto: CreateUserDTO,
    userAgent?: string,
  ): Promise<OpenedSession & { user: UserResponseDTO }> {
    // Owner decisions R2-09 and T-153: a soft-deleted account comes back only with the password it had.
    const deleted = await this.repo.getDeletedByEmail(dto.email);
    if (deleted) {
      if (
        !deleted.password ||
        !(await bcryptjs.compare(dto.password, deleted.password))
      ) {
        throw emailTaken();
      }
      try {
        const reactivated = await this.repo.reactivate(deleted.id, {
          name: dto.name,
          password: deleted.password,
          ...(dto.timezone ? { timezone: dto.timezone } : {}),
          ...(dto.locale ? { locale: dto.locale } : {}),
        });
        const tokens = await this.openSession(reactivated, userAgent);
        return {
          ...tokens,
          user: { ...toUserResponse(reactivated), reactivated: true },
        };
      } catch (err) {
        // Concurrent register already reactivated it: surface as a conflict.
        if (err instanceof ApiError && err.statusCode === 404) {
          throw emailTaken();
        }
        throw err;
      }
    }

    const hashedPassword = await bcryptjs.hash(
      dto.password,
      ENVIRONMENT.BCRYPT_SALT_ROUNDS,
    );
    const user = new User({ ...dto, password: hashedPassword });

    let created: User;
    try {
      created = await this.repo.create(user);
    } catch (err) {
      if (isDuplicateEmailError(err)) throw emailTaken();
      throw err;
    }

    try {
      await this.categoryService.seedDefaultCategories(created.id);
    } catch (error) {
      logger.error(
        { error, userId: created.id },
        "Failed to seed default categories",
      );
    }

    const tokens = await this.openSession(created, userAgent);
    return { ...tokens, user: toUserResponse(created) };
  }

  // A password change or a logout-all bumps tokenVersion, and with it every device token issued before.
  async recognizedDevice(
    deviceToken: unknown,
    email: string,
  ): Promise<string | null> {
    const claim = readDeviceToken(deviceToken, email);
    if (!claim) return null;
    const user = await this.repo.getByEmail(email);
    return user?.tokenVersion === claim.tokenVersion ? claim.deviceId : null;
  }

  async login(
    email: string,
    password: string,
    userAgent?: string,
  ): Promise<OpenedSession & { user: UserResponseDTO }> {
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
    return { ...tokens, user: toUserResponse(user) };
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
      throw new ApiError(
        "Unauthorized",
        "Invalid or expired refresh token",
        "REFRESH_INVALID",
      );
    }

    if (
      typeof payload !== "object" ||
      payload === null ||
      (payload as { type?: unknown }).type !== REFRESH_TOKEN_TYPE ||
      typeof (payload as { userId?: unknown }).userId !== "string" ||
      typeof (payload as { tokenVersion?: unknown }).tokenVersion !==
        "number" ||
      typeof (payload as { jti?: unknown }).jti !== "string"
    ) {
      throw new ApiError(
        "Unauthorized",
        "Invalid refresh token",
        "REFRESH_INVALID",
      );
    }

    return payload as unknown as RefreshPayload;
  }

  // Nobody can use the successor of an answer that never arrived: untouched means lost, not replay.
  private async tokensOfLostAnswer(
    user: User,
    stale: RefreshSession,
  ): Promise<LostAnswer> {
    if (!stale.replacedBy) return { kind: "replay" };
    const counted = await this.sessions.countReissue(stale.jti);
    if (!counted) return { kind: "replay" };
    const successor = await this.sessions.findById(stale.replacedBy);
    if (!successor || successor.revokedAt || successor.replacedBy) {
      return { kind: "replay" };
    }
    // An untouched successor is proof of a lost answer, so running out is not evidence of theft.
    if (counted.reissueCount > REFRESH_REISSUE_LIMIT) return { kind: "spent" };
    const remainingSeconds = Math.floor(
      (successor.expiresAt.getTime() - Date.now()) / 1000,
    );
    // A presented token never outlives its family: only its last second reaches this.
    if (remainingSeconds <= 0) return { kind: "replay" };
    return {
      kind: "reissued",
      tokens: {
        accessToken: this.signAccessToken(user, successor.familyId),
        refreshToken: this.signRefreshToken(
          user,
          successor.jti,
          remainingSeconds,
        ),
      },
      count: counted.reissueCount,
    };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const { userId, tokenVersion, jti } = this.verifyRefreshToken(refreshToken);

    const user = await this.repo.getById(userId);
    if (!user) {
      throw new ApiError(
        "Unauthorized",
        "Invalid refresh token",
        "REFRESH_INVALID",
      );
    }
    if (user.tokenVersion !== tokenVersion) {
      throw new ApiError(
        "Unauthorized",
        "Refresh token has been revoked",
        "REFRESH_REVOKED",
      );
    }

    const newJti = uuidv7();
    const session = await this.sessions.rotate(jti, newJti);
    if (!session) {
      const stale = await this.sessions.findById(jti);
      if (stale) {
        if (stale.revokedAt) {
          // The family was already ended on purpose: the token is over, but nobody replayed anything.
          throw new ApiError(
            "Unauthorized",
            "Refresh token has been revoked",
            "REFRESH_REVOKED",
          );
        }
        const answer = await this.tokensOfLostAnswer(user, stale);
        if (answer.kind === "reissued") {
          logger.warn(
            {
              userId,
              familyId: stale.familyId,
              reissueCount: answer.count,
            },
            "Refresh answer was lost; successor re-issued",
          );
          return answer.tokens;
        }
        if (answer.kind === "spent") {
          // The successor is still untouched, so the family is the client's: only this row is over.
          logger.warn(
            { userId, familyId: stale.familyId },
            "Refresh re-issue limit reached; rotated token retired",
          );
          throw new ApiError(
            "Unauthorized",
            "Refresh token has been revoked",
            "REFRESH_REVOKED",
          );
        }
        // Reuse of a rotated token is a replay (theft or a duplicated client): kill the whole chain.
        await this.sessions.revokeFamily(stale.familyId);
        logger.warn(
          { userId, familyId: stale.familyId },
          "Refresh token reuse detected; family revoked",
        );
        throw new ApiError(
          "Unauthorized",
          "Refresh token has been revoked",
          "REFRESH_REVOKED",
        );
      }
      throw new ApiError(
        "Unauthorized",
        "Invalid or expired refresh token",
        "REFRESH_INVALID",
      );
    }

    // Absolute cap: rotation never extends the family past its original expiry.
    const remainingSeconds = Math.floor(
      (session.expiresAt.getTime() - Date.now()) / 1000,
    );
    if (remainingSeconds <= 0) {
      // The rotation already spent the row, and a family nobody can renew is over, not stolen.
      await this.sessions.revokeFamily(session.familyId);
      throw new ApiError(
        "Unauthorized",
        "Invalid or expired refresh token",
        "REFRESH_INVALID",
      );
    }

    await this.sessions.create({
      jti: newJti,
      userId: user.id,
      familyId: session.familyId,
      expiresAt: session.expiresAt,
    });

    // Every revocation marks the parent row too, so re-reading it is enough to see a logout land here.
    const rotated = await this.sessions.findById(jti);
    if (!rotated || rotated.revokedAt) {
      await this.sessions.revokeFamily(session.familyId);
      logger.warn(
        { userId, familyId: session.familyId },
        "Logout landed mid-rotation; family closed again",
      );
      throw new ApiError(
        "Unauthorized",
        "Refresh token has been revoked",
        "REFRESH_REVOKED",
      );
    }

    return {
      accessToken: this.signAccessToken(user, session.familyId),
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

  // Global logout: version mismatch kills every refresh, and the records are marked for bookkeeping.
  async logoutAll(userId: string): Promise<void> {
    await this.repo.bumpTokenVersion(userId);
    await this.sessions.revokeAllForUser(userId);
  }

  // From the caller's `sid`; tokens minted before it existed mark nothing current until renewed.
  async listSessions(
    userId: string,
    currentFamilyId?: string,
  ): Promise<SessionView[]> {
    const sessions = await this.sessions.listActiveByUser(userId);
    return sessions.map((s) => ({ ...s, current: s.id === currentFamilyId }));
  }

  // Idempotent: revoking an own, already-revoked session is a no-op success.
  async revokeSession(userId: string, familyId: string): Promise<void> {
    const owned = await this.sessions.revokeFamilyForUser(userId, familyId);
    if (!owned) {
      throw new ApiError("NotFound", "Session not found");
    }
  }
}
