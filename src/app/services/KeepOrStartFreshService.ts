import { FreshStartDetails, User } from "../../domain/entities/User";
import { ISharedInvitationRepository } from "../../domain/repositories/sharedInvitation/ISharedInvitationRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { IUserDataEraser } from "../../domain/repositories/userData/IUserDataEraser";
import { INVITATION_STATUSES } from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import logger from "../../shared/logger";
import { toUserResponse, UserResponseDTO } from "../dtos/UserDTO";
import { CategoryService } from "./CategoryService";

// Longer than a request can live in the Lambda, so a claim outlives only a request that died.
export const START_FRESH_LEASE_MS = 5 * 60 * 1000;

export interface AnsweringSession {
  userId: string;
  // The access token's `iat`, in seconds.
  issuedAt: number | undefined;
}

const notFound = (): ApiError => new ApiError("NotFound", "User not found");

const closed = (): ApiError =>
  new ApiError(
    "Conflict",
    "This account has no open question to keep or start fresh",
    "KEEP_OR_START_FRESH_CLOSED",
  );

const inProgress = (): ApiError =>
  new ApiError(
    "Conflict",
    "Start fresh is already running for this account: wait for it to finish",
    "START_FRESH_IN_PROGRESS",
  );

const staleSession = (): ApiError =>
  new ApiError(
    "Unauthorized",
    "This session started before the question was asked: sign in again",
  );

export class KeepOrStartFreshService {
  constructor(
    private readonly users: IUserRepository,
    private readonly invitations: Pick<
      ISharedInvitationRepository,
      "withdrawAll" | "leaveAll"
    >,
    private readonly eraser: IUserDataEraser,
    private readonly categories: Pick<CategoryService, "restoreDefaults">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async keep(id: string, session: AnsweringSession): Promise<UserResponseDTO> {
    await this.answerable(id, session);
    const user = await this.users.keepEverything(id, this.now());
    if (!user) throw closed();
    return toUserResponse(user);
  }

  // Not one transaction: every step is idempotent, and the question stays open until the last one lands.
  async startFresh(
    id: string,
    session: AnsweringSession,
    details: FreshStartDetails,
  ): Promise<UserResponseDTO> {
    await this.answerable(id, session);
    const claimed = await this.users.chooseStartFresh(
      id,
      details,
      this.now(),
      START_FRESH_LEASE_MS,
    );
    if (!claimed) {
      throw (await this.users.getById(id))?.keepOrStartFresh
        ? inProgress()
        : closed();
    }

    try {
      const now = this.now();
      await this.invitations.withdrawAll(
        {
          userId: id,
          statuses: [INVITATION_STATUSES.PENDING, INVITATION_STATUSES.ACCEPTED],
        },
        now,
      );
      await this.invitations.leaveAll(id, now);
      await this.eraser.eraseAll(id);
      await this.categories.restoreDefaults(id);
    } catch (err) {
      await this.users
        .releaseStartFresh(id, this.now())
        .catch((release) =>
          logger.error(
            { err: release, code: "START_FRESH_NOT_RELEASED", userId: id },
            "Start fresh failed and its claim could not be freed: a retry waits for the lease",
          ),
        );
      throw err;
    }

    const done = await this.users.finishStartFresh(id, this.now());
    if (!done) throw closed();
    return toUserResponse(done);
  }

  // Only a session opened after the question: an access token from before the reset is the other person's.
  private async answerable(
    id: string,
    session: AnsweringSession,
  ): Promise<User> {
    if (id !== session.userId) throw notFound();
    const user = await this.users.getById(id);
    if (!user) throw notFound();
    if (!user.keepOrStartFresh) throw closed();
    const askedAt = Math.floor(user.keepOrStartFresh.askedAt.getTime() / 1000);
    if (session.issuedAt === undefined || session.issuedAt < askedAt) {
      throw staleSession();
    }
    return user;
  }
}
