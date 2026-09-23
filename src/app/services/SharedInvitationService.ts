import { SharedGroup } from "../../domain/entities/SharedGroup";
import {
  ReceivedInvitationView,
  receivedView,
  SentInvitationView,
  sentView,
  SharedInvitation,
} from "../../domain/entities/SharedInvitation";
import { User } from "../../domain/entities/User";
import { IContactRepository } from "../../domain/repositories/contact/IContactRepository";
import { ISharedGroupRepository } from "../../domain/repositories/sharedGroup/ISharedGroupRepository";
import { ISharedInvitationRepository } from "../../domain/repositories/sharedInvitation/ISharedInvitationRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import {
  INVITATION_LIFETIME_DAYS,
  INVITATION_STATUSES,
  InvitationStatus,
  MAX_PENDING_INVITATIONS_PER_USER,
} from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { withTransaction } from "../../shared/unitOfWork";

const DAY_MS = 24 * 60 * 60 * 1000;

const unavailable = (): ApiError =>
  new ApiError(
    "BadRequest",
    "This invitation is no longer available",
    "INVITATION_UNAVAILABLE",
  );

export interface InviteOutcome {
  created: boolean;
}

export class SharedInvitationService {
  constructor(
    private repo: ISharedInvitationRepository,
    private groupRepo: ISharedGroupRepository,
    private contactRepo: IContactRepository,
    private userRepo: IUserRepository,
  ) {}

  private async ownedGroup(
    groupId: string,
    userId: string,
  ): Promise<SharedGroup> {
    const group = await this.groupRepo.getByIdIncludingArchived(groupId);
    if (!group || group.userId !== userId) {
      throw new ApiError("NotFound", "Shared group not found");
    }
    return group;
  }

  private async me(userId: string): Promise<User> {
    const user = await this.userRepo.getById(userId);
    if (!user) throw new ApiError("NotFound", "User not found");
    return user;
  }

  async invite(
    groupId: string,
    contactId: string,
    userId: string,
    outcome?: InviteOutcome,
  ): Promise<SentInvitationView> {
    const group = await this.ownedGroup(groupId, userId);
    if (group.archivedAt) {
      throw new ApiError(
        "BadRequest",
        "Shared group is archived; restore it first",
        "RESOURCE_ARCHIVED",
      );
    }
    if (!group.participants.some((p) => p.contactId === contactId)) {
      throw new ApiError(
        "BadRequest",
        "That person is not in this shared group",
        "PARTICIPANT_NOT_IN_GROUP",
      );
    }
    const contact = await this.contactRepo.getOwnById(contactId, userId);
    if (!contact || contact.archivedAt) {
      throw new ApiError("NotFound", "Contact not found");
    }
    if (!contact.email) {
      throw new ApiError(
        "BadRequest",
        "Add an email to this contact to invite them",
        "CONTACT_HAS_NO_EMAIL",
      );
    }
    const inviter = await this.me(userId);
    if (contact.email === inviter.email) {
      throw new ApiError(
        "BadRequest",
        "That is your own email",
        "INVITATION_TO_SELF",
      );
    }

    const now = new Date();
    if (
      (await this.repo.countWaitingBy(userId, now)) >=
      MAX_PENDING_INVITATIONS_PER_USER
    ) {
      const live = await this.repo.findLive(groupId, contactId);
      if (
        !live ||
        !(
          live.isAnswerable(now) || live.status === INVITATION_STATUSES.ACCEPTED
        )
      ) {
        throw new ApiError(
          "BadRequest",
          `At most ${MAX_PENDING_INVITATIONS_PER_USER} invitations can wait at once`,
          "INVITATION_LIMIT_REACHED",
        );
      }
      if (outcome) outcome.created = false;
      return sentView(live);
    }

    const { invitation, created } = await this.repo.openOne(
      new SharedInvitation({
        userId,
        groupId,
        contactId,
        email: contact.email,
        expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_DAYS * DAY_MS),
        groupName: group.name,
        groupColor: group.color,
        groupCurrency: group.currency ?? inviter.currency,
        inviterName: inviter.name,
        inviterEmail: inviter.email,
      }),
      now,
    );
    if (outcome) outcome.created = created;
    return sentView(invitation);
  }

  async listForGroup(
    groupId: string,
    userId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SentInvitationView>> {
    await this.ownedGroup(groupId, userId);
    const result = await this.repo.listByGroup(userId, groupId, pagination);
    return { data: result.data.map(sentView), pagination: result.pagination };
  }

  async withdraw(
    groupId: string,
    invitationId: string,
    userId: string,
  ): Promise<SentInvitationView> {
    const existing = await this.repo.getById(invitationId);
    if (
      !existing ||
      existing.userId !== userId ||
      existing.groupId !== groupId
    ) {
      throw new ApiError("NotFound", "Invitation not found");
    }
    const withdrawn = await this.repo.withdraw(invitationId, new Date());
    if (withdrawn) return sentView(withdrawn);
    const current = await this.repo.getById(invitationId);
    return sentView(current ?? existing);
  }

  async listReceived(
    userId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<ReceivedInvitationView>> {
    const me = await this.me(userId);
    const result = await this.repo.listAnswerable(
      me.email,
      new Date(),
      pagination,
    );
    return {
      data: result.data.map(receivedView),
      pagination: result.pagination,
    };
  }

  private async addressedToMe(id: string, me: User): Promise<SharedInvitation> {
    const invitation = await this.repo.getById(id);
    const mine =
      invitation?.inviteeId === me.id ||
      (invitation?.email === me.email && invitation.inviteeId === null);
    if (!invitation || !mine) {
      throw new ApiError("NotFound", "Invitation not found");
    }
    if (invitation.userId === me.id) {
      throw new ApiError(
        "BadRequest",
        "That invitation is your own",
        "INVITATION_TO_SELF",
      );
    }
    return invitation;
  }

  private settledAs(
    invitation: SharedInvitation,
    status: InvitationStatus,
    me: User,
  ): boolean {
    return invitation.status === status && invitation.inviteeId === me.id;
  }

  async accept(id: string, userId: string): Promise<ReceivedInvitationView> {
    const me = await this.me(userId);
    const invitation = await this.addressedToMe(id, me);
    if (this.settledAs(invitation, INVITATION_STATUSES.ACCEPTED, me)) {
      return receivedView(invitation);
    }
    const now = new Date();
    if (!invitation.isAnswerable(now)) throw unavailable();
    if (!(await this.userRepo.getById(invitation.userId))) throw unavailable();
    if (invitation.groupCurrency !== me.currency) {
      throw new ApiError(
        "BadRequest",
        `This group is in ${invitation.groupCurrency} and your money is in ${me.currency}`,
        "CURRENCY_MISMATCH",
      );
    }

    return withTransaction(async (session) => {
      const group = await this.groupRepo.getByIdIncludingArchived(
        invitation.groupId,
        session,
      );
      if (
        !group ||
        group.archivedAt ||
        !group.participants.some((p) => p.contactId === invitation.contactId)
      ) {
        throw unavailable();
      }
      if (await this.repo.hasJoined(invitation.groupId, me.id, session)) {
        throw new ApiError(
          "BadRequest",
          "You are already in this shared group",
          "PARTICIPANT_ALREADY_IN_GROUP",
        );
      }
      const accepted = await this.repo.answer(
        id,
        INVITATION_STATUSES.ACCEPTED,
        me.id,
        now,
        session,
      );
      if (!accepted) throw unavailable();
      return receivedView(accepted);
    });
  }

  async decline(id: string, userId: string): Promise<ReceivedInvitationView> {
    const me = await this.me(userId);
    const invitation = await this.addressedToMe(id, me);
    if (this.settledAs(invitation, INVITATION_STATUSES.DECLINED, me)) {
      return receivedView(invitation);
    }
    const declined = await this.repo.answer(
      id,
      INVITATION_STATUSES.DECLINED,
      me.id,
      new Date(),
    );
    if (!declined) throw unavailable();
    return receivedView(declined);
  }

  async leave(id: string, userId: string): Promise<ReceivedInvitationView> {
    const invitation = await this.repo.getById(id);
    if (!invitation || invitation.inviteeId !== userId) {
      throw new ApiError("NotFound", "Invitation not found");
    }
    if (invitation.status === INVITATION_STATUSES.LEFT) {
      return receivedView(invitation);
    }
    const left = await this.repo.leave(id, userId, new Date());
    if (!left) throw unavailable();
    return receivedView(left);
  }
}
