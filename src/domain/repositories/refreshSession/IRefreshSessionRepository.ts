export interface RefreshSession {
  jti: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  replacedBy: string | null;
  revokedAt: Date | null;
  // When this row was rotated away; null while it is the live tip of its chain.
  lastUsedAt: Date | null;
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

  // Null when already rotated, revoked or missing, which callers treat as reuse.
  rotate(jti: string, newJti: string): Promise<RefreshSession | null>;

  revokeFamily(familyId: string): Promise<void>;

  revokeAllForUser(userId: string): Promise<void>;

  // Active (non-revoked, non-expired) session families of the user.
  listActiveByUser(userId: string): Promise<SessionSummary[]>;

  // False when the family is not the user's; an already-revoked own family returns true.
  revokeFamilyForUser(userId: string, familyId: string): Promise<boolean>;
}
