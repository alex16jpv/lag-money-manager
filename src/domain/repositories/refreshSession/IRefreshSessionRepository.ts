export interface RefreshSession {
  jti: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  replacedBy: string | null;
  revokedAt: Date | null;
}

export interface IRefreshSessionRepository {
  create(session: {
    jti: string;
    userId: string;
    familyId: string;
    expiresAt: Date;
    userAgent?: string;
  }): Promise<void>;

  findById(jti: string): Promise<RefreshSession | null>;

  // Atomically marks an ACTIVE session as rotated; null when the session was
  // already rotated/revoked or does not exist (callers treat that as reuse).
  rotate(jti: string, newJti: string): Promise<RefreshSession | null>;

  revokeFamily(familyId: string): Promise<void>;

  revokeAllForUser(userId: string): Promise<void>;
}
