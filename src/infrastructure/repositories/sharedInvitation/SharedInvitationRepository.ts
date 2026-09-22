import { SharedInvitation } from "../../../domain/entities/SharedInvitation";
import {
  InvitationScope,
  ISharedInvitationRepository,
  OpenInvitationResult,
} from "../../../domain/repositories/sharedInvitation/ISharedInvitationRepository";
import {
  Color,
  INVITATION_STATUSES,
  InvitationStatus,
} from "../../../shared/constants";
import {
  buildPaginatedResult,
  pageQueryLimit,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { ChangeCursor, compareChanges } from "../../../shared/syncCursor";
import { TxSession } from "../../../shared/unitOfWork";
import {
  ISharedInvitationDocument,
  SharedInvitationModel,
} from "../../models/SharedInvitationModel";
import { CHANGE_FEED_SORT, changesSinceFilter } from "../changeFeed";
import { ID_CURSOR_SORT, invalidCursor } from "../keysetCursor";

const LIVE = [INVITATION_STATUSES.PENDING, INVITATION_STATUSES.ACCEPTED];

export class SharedInvitationRepository implements ISharedInvitationRepository {
  private toEntity(doc: ISharedInvitationDocument): SharedInvitation {
    return new SharedInvitation({
      id: doc._id,
      userId: doc.userId,
      groupId: doc.groupId,
      contactId: doc.contactId,
      email: doc.email,
      status: doc.status,
      expiresAt: doc.expiresAt,
      inviteeId: doc.inviteeId ?? null,
      answeredAt: doc.answeredAt,
      withdrawnAt: doc.withdrawnAt,
      groupName: doc.groupName,
      groupColor: doc.groupColor,
      groupCurrency: doc.groupCurrency,
      inviterName: doc.inviterName,
      inviterEmail: doc.inviterEmail,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  // The pivot has to be one of the rows the scope reaches: a foreign id is not a place to start from.
  private async paginate(
    scope: Record<string, unknown>,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedInvitation>> {
    const { limit, offset, cursor } = pagination;
    let filter: Record<string, unknown> = scope;
    if (cursor) {
      const pivot = await SharedInvitationModel.exists({
        ...scope,
        _id: cursor,
      });
      if (!pivot) throw invalidCursor();
      filter = { ...scope, _id: { $gt: cursor } };
    }
    const [docs, total] = await Promise.all([
      SharedInvitationModel.find(filter)
        .sort(ID_CURSOR_SORT)
        .skip(cursor ? 0 : offset)
        .limit(pageQueryLimit(limit))
        .lean(),
      SharedInvitationModel.countDocuments(scope),
    ]);
    return buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
  }

  async getById(
    id: string,
    session?: TxSession,
  ): Promise<SharedInvitation | null> {
    const doc = await SharedInvitationModel.findById(id)
      .session(session ?? null)
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  async sentChangesSince(
    userId: string,
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<SharedInvitation[]> {
    const docs = await SharedInvitationModel.find(
      changesSinceFilter(userId, cursor),
    )
      .sort(CHANGE_FEED_SORT)
      .limit(limit)
      .lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async receivedChangesSince(
    inviteeId: string,
    email: string,
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<SharedInvitation[]> {
    const [byEmail, byInvitee] = await Promise.all([
      SharedInvitationModel.find(changesSinceFilter(email, cursor, "email"))
        .sort(CHANGE_FEED_SORT)
        .limit(limit)
        .lean(),
      SharedInvitationModel.find(
        changesSinceFilter(inviteeId, cursor, "inviteeId"),
      )
        .sort(CHANGE_FEED_SORT)
        .limit(limit)
        .lean(),
    ]);
    const byId = new Map(
      [...byEmail, ...byInvitee].map((doc) => [doc._id, this.toEntity(doc)]),
    );
    return [...byId.values()].sort(compareChanges).slice(0, limit);
  }

  async listByGroup(
    userId: string,
    groupId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedInvitation>> {
    return this.paginate({ userId, groupId }, pagination);
  }

  async listAnswerable(
    email: string,
    now: Date,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedInvitation>> {
    return this.paginate(
      {
        email,
        status: INVITATION_STATUSES.PENDING,
        expiresAt: { $gt: now },
      },
      pagination,
    );
  }

  async countWaitingBy(userId: string, now: Date): Promise<number> {
    return SharedInvitationModel.countDocuments({
      userId,
      status: INVITATION_STATUSES.PENDING,
      expiresAt: { $gt: now },
    });
  }

  async findLive(
    groupId: string,
    contactId: string,
  ): Promise<SharedInvitation | null> {
    const doc = await SharedInvitationModel.findOne({
      groupId,
      contactId,
      open: true,
    }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async openOne(
    invitation: SharedInvitation,
    now: Date,
    session?: TxSession,
  ): Promise<OpenInvitationResult> {
    const pair = {
      groupId: invitation.groupId,
      contactId: invitation.contactId,
    };
    await SharedInvitationModel.updateMany(
      {
        ...pair,
        open: true,
        status: INVITATION_STATUSES.PENDING,
        expiresAt: { $lte: now },
      },
      { $unset: { open: "" } },
      { session: session ?? undefined },
    );
    const { id, ...fields } = invitation;
    const written = await SharedInvitationModel.updateOne(
      { ...pair, open: true },
      { $setOnInsert: { _id: id, ...fields, open: true } },
      { upsert: true, session: session ?? undefined },
    );
    const doc = await SharedInvitationModel.findOne({ ...pair, open: true })
      .session(session ?? null)
      .lean();
    if (!doc) throw new Error("The live invitation vanished between two reads");
    return {
      invitation: this.toEntity(doc),
      created: written.upsertedCount === 1,
    };
  }

  async answer(
    id: string,
    status: InvitationStatus,
    inviteeId: string,
    now: Date,
    session?: TxSession,
  ): Promise<SharedInvitation | null> {
    const stillOpen = status === INVITATION_STATUSES.ACCEPTED;
    const doc = await SharedInvitationModel.findOneAndUpdate(
      {
        _id: id,
        status: INVITATION_STATUSES.PENDING,
        expiresAt: { $gt: now },
      },
      {
        $set: { status, inviteeId, answeredAt: now },
        ...(stillOpen ? {} : { $unset: { open: "" } }),
      },
      { new: true, session: session ?? undefined },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async withdraw(
    id: string,
    now: Date,
    session?: TxSession,
  ): Promise<SharedInvitation | null> {
    const doc = await SharedInvitationModel.findOneAndUpdate(
      { _id: id, status: { $in: LIVE } },
      {
        $set: { status: INVITATION_STATUSES.WITHDRAWN, withdrawnAt: now },
        $unset: { open: "" },
      },
      { new: true, session: session ?? undefined },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async withdrawAll(
    scope: InvitationScope,
    now: Date,
    session?: TxSession,
  ): Promise<number> {
    const { userId, groupId, contactId, statuses } = scope;
    const result = await SharedInvitationModel.updateMany(
      {
        userId,
        ...(groupId && { groupId }),
        ...(contactId && { contactId }),
        status: { $in: statuses },
      },
      {
        $set: { status: INVITATION_STATUSES.WITHDRAWN, withdrawnAt: now },
        $unset: { open: "" },
      },
      { session: session ?? undefined },
    );
    return result.modifiedCount;
  }

  async refreshGroup(
    userId: string,
    groupId: string,
    group: { groupName: string; groupColor?: Color },
    session?: TxSession,
  ): Promise<void> {
    await SharedInvitationModel.updateMany(
      { userId, groupId, status: INVITATION_STATUSES.PENDING },
      group.groupColor
        ? { $set: { groupName: group.groupName, groupColor: group.groupColor } }
        : { $set: { groupName: group.groupName }, $unset: { groupColor: "" } },
      { session: session ?? undefined },
    );
  }

  async hasJoined(
    groupId: string,
    inviteeId: string,
    session?: TxSession,
  ): Promise<boolean> {
    const doc = await SharedInvitationModel.exists({
      groupId,
      inviteeId,
      status: INVITATION_STATUSES.ACCEPTED,
    }).session(session ?? null);
    return doc !== null;
  }
}
