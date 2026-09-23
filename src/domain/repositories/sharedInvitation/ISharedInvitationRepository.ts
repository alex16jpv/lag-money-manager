import { Color, InvitationStatus } from "../../../shared/constants";
import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { ChangeCursor } from "../../../shared/syncCursor";
import { TxSession } from "../../../shared/unitOfWork";
import { SharedInvitation } from "../../entities/SharedInvitation";

export interface OpenInvitationResult {
  invitation: SharedInvitation;
  created: boolean;
}

export interface InvitationScope {
  userId: string;
  groupId?: string;
  contactId?: string;
  statuses: InvitationStatus[];
}

export interface ISharedInvitationRepository {
  getById(id: string, session?: TxSession): Promise<SharedInvitation | null>;

  sentChangesSince(
    userId: string,
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<SharedInvitation[]>;
  // Addressed to the email and unanswered, or answered by this user: never another user's answers.
  receivedChangesSince(
    inviteeId: string,
    email: string,
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<SharedInvitation[]>;

  listByGroup(
    userId: string,
    groupId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedInvitation>>;
  listAnswerable(
    email: string,
    now: Date,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedInvitation>>;
  countWaitingBy(userId: string, now: Date): Promise<number>;
  findLive(
    groupId: string,
    contactId: string,
  ): Promise<SharedInvitation | null>;

  openOne(
    invitation: SharedInvitation,
    now: Date,
    session?: TxSession,
  ): Promise<OpenInvitationResult>;
  answer(
    id: string,
    status: InvitationStatus,
    inviteeId: string,
    now: Date,
    session?: TxSession,
  ): Promise<SharedInvitation | null>;
  withdraw(
    id: string,
    now: Date,
    session?: TxSession,
  ): Promise<SharedInvitation | null>;
  withdrawAll(
    scope: InvitationScope,
    now: Date,
    session?: TxSession,
  ): Promise<number>;
  refreshGroup(
    userId: string,
    groupId: string,
    group: { groupName: string; groupColor?: Color },
    session?: TxSession,
  ): Promise<void>;
  // Ends a joined invitation from the invited person's side; null when it was not theirs and live.
  leave(
    id: string,
    inviteeId: string,
    now: Date,
  ): Promise<SharedInvitation | null>;
  leaveAll(inviteeId: string, now: Date): Promise<number>;
  // The groups this user joined: their accepted, live invitations.
  memberships(
    inviteeId: string,
    session?: TxSession,
  ): Promise<SharedInvitation[]>;
  membershipsPage(
    inviteeId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedInvitation>>;
  // Every invitation of these groups, in any state: who joined them, and when that last changed.
  inGroups(ownerIds: string[], groupIds: string[]): Promise<SharedInvitation[]>;
  hasJoined(
    groupId: string,
    inviteeId: string,
    session?: TxSession,
  ): Promise<boolean>;
}
