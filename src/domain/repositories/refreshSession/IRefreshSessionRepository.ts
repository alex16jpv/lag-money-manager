export interface RefreshSession {
  jti: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  replacedBy: string | null;
  revokedAt: Date | null;
}

// One row per live device session (rotation family), for the sessions UI.
export interface SessionSummary {
  id: string; // familyId
  createdAt: Date; // when the device logged in (family root)
  lastUsedAt: Date; // last refresh (or login when never refreshed)
  expiresAt: Date;
  userAgent?: string;
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

  // Active (non-revoked, non-expired) session families of the user.
  listActiveByUser(userId: string): Promise<SessionSummary[]>;

  // Revokes one family, scoped to its owner; false when the family is not
  // the user's (idempotent: an already-revoked own family returns true).
  revokeFamilyForUser(userId: string, familyId: string): Promise<boolean>;
}
