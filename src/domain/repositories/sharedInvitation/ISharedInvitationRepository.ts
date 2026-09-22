import { Color, InvitationStatus } from "../../../shared/constants";
import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { ChangeCursor } from "../../../shared/syncCursor";
import { TxSession } from "../../../shared/unitOfWork";
import { SharedInvitation } from "../../entities/SharedInvitation";

export interface OpenInvitationResult {
  invitation: SharedInvitation;
  created: boolean;
}

// Which live invitations a change ends: a group's, or one person's in one group or in all of them.
export interface InvitationScope {
  userId: string;
  groupId?: string;
  contactId?: string;
  statuses: InvitationStatus[];
}

export interface ISharedInvitationRepository {
  getById(id: string, session?: TxSession): Promise<SharedInvitation | null>;

  // The inviter's rows, after `cursor` in (updatedAt, _id) order.
  sentChangesSince(
    userId: string,
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<SharedInvitation[]>;
  // The invited person's rows: addressed to their email, or answered by them.
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
  // Waiting for this address and still in time.
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

  // The live one for this person in this group, or a new one; an expired one steps aside first.
  openOne(
    invitation: SharedInvitation,
    now: Date,
    session?: TxSession,
  ): Promise<OpenInvitationResult>;
  // Only a waiting, unexpired invitation moves; null when it was not one any more.
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
  // A waiting invitation shows the group as it is now.
  refreshGroup(
    userId: string,
    groupId: string,
    group: { groupName: string; groupColor?: Color },
    session?: TxSession,
  ): Promise<void>;
  hasJoined(
    groupId: string,
    inviteeId: string,
    session?: TxSession,
  ): Promise<boolean>;
}
