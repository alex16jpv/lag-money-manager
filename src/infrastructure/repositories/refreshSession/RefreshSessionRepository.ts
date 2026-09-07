import {
  IRefreshSessionRepository,
  RefreshSession,
  SessionSummary,
} from "../../../domain/repositories/refreshSession/IRefreshSessionRepository";
import {
  IRefreshSessionDocument,
  RefreshSessionModel,
} from "../../models/RefreshSessionModel";

export class RefreshSessionRepository implements IRefreshSessionRepository {
  private toEntity(doc: IRefreshSessionDocument): RefreshSession {
    return {
      jti: doc._id,
      userId: doc.userId,
      familyId: doc.familyId,
      expiresAt: doc.expiresAt,
      replacedBy: doc.replacedBy,
      revokedAt: doc.revokedAt,
    };
  }

  async create(session: {
    jti: string;
    userId: string;
    familyId: string;
    expiresAt: Date;
    userAgent?: string;
  }): Promise<void> {
    await RefreshSessionModel.create({
      _id: session.jti,
      userId: session.userId,
      familyId: session.familyId,
      expiresAt: session.expiresAt,
      userAgent: session.userAgent,
    });
  }

  async findById(jti: string): Promise<RefreshSession | null> {
    const doc = await RefreshSessionModel.findById(jti).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async rotate(jti: string, newJti: string): Promise<RefreshSession | null> {
    const doc = await RefreshSessionModel.findOneAndUpdate(
      { _id: jti, replacedBy: null, revokedAt: null },
      { $set: { replacedBy: newJti, lastUsedAt: new Date() } },
      { new: true },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await RefreshSessionModel.updateMany(
      { familyId, revokedAt: null },
      { revokedAt: new Date() },
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await RefreshSessionModel.updateMany(
      { userId, revokedAt: null },
      { revokedAt: new Date() },
    );
  }

  async listActiveByUser(userId: string): Promise<SessionSummary[]> {
    // Group the rotation chain per family: root brings login time and
    // userAgent; the chain tip (replacedBy: null) proves the family is live.
    const rows = await RefreshSessionModel.aggregate<{
      _id: string;
      createdAt: Date;
      userAgent?: string;
      lastUsedAt: Date;
      expiresAt: Date;
      live: number;
    }>([
      { $match: { userId, revokedAt: null } },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: "$familyId",
          createdAt: { $first: "$createdAt" },
          userAgent: { $first: "$userAgent" },
          lastUsedAt: { $max: { $ifNull: ["$lastUsedAt", "$createdAt"] } },
          expiresAt: { $max: "$expiresAt" },
          live: {
            $max: { $cond: [{ $eq: ["$replacedBy", null] }, 1, 0] },
          },
        },
      },
      { $match: { live: 1, expiresAt: { $gt: new Date() } } },
      { $sort: { lastUsedAt: -1 } },
    ]);
    return rows.map((r) => ({
      id: r._id,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      userAgent: r.userAgent,
    }));
  }

  async revokeFamilyForUser(
    userId: string,
    familyId: string,
  ): Promise<boolean> {
    const exists = await RefreshSessionModel.exists({ familyId, userId });
    if (!exists) return false;
    await RefreshSessionModel.updateMany(
      { familyId, userId, revokedAt: null },
      { revokedAt: new Date() },
    );
    return true;
  }
}
