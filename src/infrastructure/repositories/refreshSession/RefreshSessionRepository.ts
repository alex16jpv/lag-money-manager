import {
  IRefreshSessionRepository,
  RefreshSession,
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
}
