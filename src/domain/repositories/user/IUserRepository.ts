import { TxSession } from "../../../shared/unitOfWork";
import {
  FreshStartDetails,
  PendingEmailChange,
  User,
} from "../../entities/User";
import { IRepository } from "../IRepository";

export interface IUserRepository extends IRepository<User> {
  delete(id: string, session?: TxSession): Promise<void>;
  getByEmail(email: string): Promise<User | null>;
  getManyByIds(ids: string[]): Promise<User[]>;
  // Unlike getById, keeps the password hash (current-password verification).
  getByIdWithPassword(id: string): Promise<User | null>;
  // Atomic $inc: revokes every live refresh token of the user.
  bumpTokenVersion(id: string): Promise<void>;
  // Fields and tokenVersion in one atomic write, so a concurrent logout-all cannot lose a revocation.
  updateWithTokenBump(id: string, fields: Partial<User>): Promise<User>;
  // Stamps lastLoginAt; fire-and-forget semantics (no error surfaced).
  recordLogin(id: string): Promise<void>;
  getDeletedByEmail(email: string): Promise<User | null>;
  // One atomic write: password, tokenVersion, email confirmed, and the question only if it never was.
  resetPassword(
    id: string,
    passwordHash: string,
    question: { accounts: number; transactions: number } | null,
    now: Date,
  ): Promise<User | null>;
  // Null when the account no longer has this address; the account as it is when it was already confirmed.
  markEmailVerified(id: string, email: string, now: Date): Promise<User | null>;
  // Any account holding the address, deleted ones included: the unique index counts them all.
  emailInUse(email: string): Promise<boolean>;
  startEmailChange(
    id: string,
    change: PendingEmailChange,
  ): Promise<User | null>;
  // Null when the account no longer waits for this address.
  renewEmailChange(
    id: string,
    email: string,
    sentAt: Date,
    expiresAt: Date,
  ): Promise<User | null>;
  // With an email, only while the account still waits for that address.
  dropEmailChange(id: string, email?: string): Promise<void>;
  // One write: the address, its confirmation and tokenVersion. "taken" when another account holds it now.
  applyEmailChange(
    id: string,
    email: string,
    now: Date,
  ): Promise<User | "taken" | null>;
  // Never confirmed, deleted or not, including one whose erasure started and has to finish.
  getForErasure(id: string): Promise<User | null>;
  // Takes the account out of every read; null once it was confirmed, or moved after the token was issued.
  claimErasure(
    id: string,
    email: string,
    tokenIssuedAt: Date,
    now: Date,
  ): Promise<User | null>;
  // The one hard delete of an account: only one claimErasure marked.
  eraseForGood(id: string): Promise<void>;
  // Each resolves null when the question is not open for that answer.
  keepEverything(id: string, now: Date): Promise<User | null>;
  // Null also while another request holds the claim and its lease has not run out.
  chooseStartFresh(
    id: string,
    details: FreshStartDetails,
    now: Date,
    leaseMs: number,
  ): Promise<User | null>;
  releaseStartFresh(id: string, now: Date): Promise<void>;
  finishStartFresh(id: string, now: Date): Promise<User | null>;
  // Clears the soft delete; the account keeps its financial history.
  reactivate(
    id: string,
    updates: Pick<User, "name" | "password"> &
      Partial<Pick<User, "timezone" | "locale">>,
  ): Promise<User>;
}
