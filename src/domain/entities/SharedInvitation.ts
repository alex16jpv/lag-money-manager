import { v7 as uuidv7 } from "uuid";

import {
  Color,
  INVITATION_STATUSES,
  InvitationStatus,
} from "../../shared/constants";

export interface SharedInvitationProps {
  id?: string;
  userId: string;
  groupId: string;
  contactId: string;
  email: string;
  status?: InvitationStatus;
  expiresAt: Date;
  inviteeId?: string | null;
  answeredAt?: Date | null;
  withdrawnAt?: Date | null;
  leftAt?: Date | null;
  groupName: string;
  groupColor?: Color;
  groupCurrency: string;
  inviterName: string;
  inviterEmail: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class SharedInvitation {
  id: string;
  userId: string;
  groupId: string;
  contactId: string;
  email: string;
  status: InvitationStatus;
  expiresAt: Date;
  inviteeId: string | null;
  answeredAt: Date | null;
  withdrawnAt: Date | null;
  leftAt: Date | null;
  groupName: string;
  groupColor?: Color;
  groupCurrency: string;
  inviterName: string;
  inviterEmail: string;
  createdAt?: Date;
  updatedAt?: Date;

  constructor(props: SharedInvitationProps) {
    this.id = props.id ?? uuidv7();
    this.userId = props.userId;
    this.groupId = props.groupId;
    this.contactId = props.contactId;
    this.email = props.email;
    this.status = props.status ?? INVITATION_STATUSES.PENDING;
    this.expiresAt = props.expiresAt;
    this.inviteeId = props.inviteeId ?? null;
    this.answeredAt = props.answeredAt ?? null;
    this.withdrawnAt = props.withdrawnAt ?? null;
    this.leftAt = props.leftAt ?? null;
    this.groupName = props.groupName;
    this.groupColor = props.groupColor;
    this.groupCurrency = props.groupCurrency;
    this.inviterName = props.inviterName;
    this.inviterEmail = props.inviterEmail;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  isAnswerable(now: Date): boolean {
    return (
      this.status === INVITATION_STATUSES.PENDING &&
      now.getTime() < this.expiresAt.getTime()
    );
  }
}

export interface SentInvitationView {
  id: string;
  groupId: string;
  contactId: string;
  email: string;
  status: InvitationStatus;
  expiresAt: Date;
  answeredAt: Date | null;
  withdrawnAt: Date | null;
  leftAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ReceivedInvitationView {
  id: string;
  groupId: string;
  groupName: string;
  groupColor: Color | null;
  groupCurrency: string;
  inviterName: string;
  inviterEmail: string;
  status: InvitationStatus;
  expiresAt: Date;
  answeredAt: Date | null;
  leftAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const sentView = (inv: SharedInvitation): SentInvitationView => ({
  id: inv.id,
  groupId: inv.groupId,
  contactId: inv.contactId,
  email: inv.email,
  status: inv.status,
  expiresAt: inv.expiresAt,
  answeredAt: inv.answeredAt,
  withdrawnAt: inv.withdrawnAt,
  leftAt: inv.leftAt,
  createdAt: inv.createdAt,
  updatedAt: inv.updatedAt,
});

export const receivedView = (
  inv: SharedInvitation,
): ReceivedInvitationView => ({
  id: inv.id,
  groupId: inv.groupId,
  groupName: inv.groupName,
  groupColor: inv.groupColor ?? null,
  groupCurrency: inv.groupCurrency,
  inviterName: inv.inviterName,
  inviterEmail: inv.inviterEmail,
  status: inv.status,
  expiresAt: inv.expiresAt,
  answeredAt: inv.answeredAt,
  leftAt: inv.leftAt,
  createdAt: inv.createdAt,
  updatedAt: inv.updatedAt,
});
