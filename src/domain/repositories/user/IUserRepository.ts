import {
  ConfirmDeadline,
  PendingEmailChange,
  RestoreLink,
  UndoLink,
  User,
} from "../../entities/User";
import { IRepository } from "../IRepository";

// Who an address belongs to: an account (live, or deleted and still kept), or one whose working undo link keeps it.
export type AddressHolder =
  | { state: "live"; user: User }
  | { state: "deleted"; user: User }
  | { state: "held"; user: User; freeAt: Date };

export interface IUserRepository extends Omit<IRepository<User>, "delete"> {
  getByEmail(email: string): Promise<User | null>;
  getManyByIds(ids: string[]): Promise<User[]>;
  // Unlike getById, keeps the password hash (current-password verification).
  getByIdWithPassword(id: string): Promise<User | null>;
  // Live, or deleted and still kept: what Sign in and Forgot your password? reach. With the password hash.
  getReachableByEmail(email: string, now: Date): Promise<User | null>;
  holderOf(
    email: string,
    now: Date,
    exceptUserId?: string,
  ): Promise<AddressHolder | null>;
  // Atomic $inc of tokenVersion, and every device token issued before is unknown to new-sign-in.
  forgetDevices(id: string, now: Date): Promise<User | null>;
  // Fields and tokenVersion in one atomic write, so a concurrent logout-all cannot lose a revocation.
  updateWithTokenBump(id: string, fields: Partial<User>): Promise<User>;
  // Stamps lastLoginAt; fire-and-forget semantics (no error surfaced).
  recordLogin(id: string): Promise<void>;
  // One atomic write: password, tokenVersion, email confirmed, no change waiting, and back if it was deleted and still kept.
  resetPassword(
    id: string,
    passwordHash: string,
    now: Date,
  ): Promise<User | null>;
  // Null when the account no longer has this address; the account as it is when it was already confirmed.
  markEmailVerified(id: string, email: string, now: Date): Promise<User | null>;
  startEmailChange(
    id: string,
    change: PendingEmailChange,
  ): Promise<User | null>;
  // Keeps the link's address in heldEmails in the same write.
  addUndoLink(id: string, link: UndoLink, now: Date): Promise<boolean>;
  dropUndoLink(id: string, tokenHash: string): Promise<void>;
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
  // Live or deleted: an undo or restore link also brings back an account deleted after it was sent.
  getForUndo(id: string): Promise<User | null>;
  // One write: back to the link's address, not deleted, no password; the links issued before it survive. Null once it no longer works.
  undoEmailChange(
    id: string,
    link: UndoLink,
    unusablePasswordHash: string,
    now: Date,
  ): Promise<User | null>;
  // Delete account: out of every read, tokenVersion bumped, kept until keptUntil with its restore link.
  markDeleted(
    id: string,
    keptUntil: Date,
    link: RestoreLink,
    now: Date,
  ): Promise<User | null>;
  // Signing in with its password; null unless it is deleted and still kept.
  restoreDeleted(id: string, now: Date): Promise<User | null>;
  // One write: back, no usable password, every device forgotten, the link spent. Also when it was already back.
  restoreFromLink(
    id: string,
    tokenHash: string,
    unusablePasswordHash: string,
    now: Date,
  ): Promise<User | null>;
  // Deleted before keptUntil existed: each gets its day from the nightly pass.
  listUndatedDeletions(limit: number): Promise<User[]>;
  setKeptUntil(id: string, keptUntil: Date): Promise<void>;
  // Past keptUntil, or claimed by an erasure that has to finish.
  listErasable(
    now: Date,
    limit: number,
    exceptIds: string[],
  ): Promise<string[]>;
  // Takes the account out of every read and frees its address; false when it is not erasable any more.
  claimErasure(id: string, now: Date): Promise<boolean>;
  // The one hard delete of an account: only one claimErasure marked.
  eraseForGood(id: string): Promise<void>;
  // Live accounts from before email existed that were never given a deadline.
  listWithoutDeadline(limit: number, exceptIds: string[]): Promise<User[]>;
  // False when the account was confirmed, moved or given a deadline meanwhile.
  startConfirmDeadline(
    id: string,
    email: string,
    deadline: ConfirmDeadline,
  ): Promise<boolean>;
  // Unconfirmed, not reminded, and the deadline ends after now and no later than endsBy.
  listDueReminders(
    now: Date,
    endsBy: Date,
    limit: number,
    exceptIds: string[],
  ): Promise<User[]>;
  markReminded(
    id: string,
    link: { email: string; tokenHash: string },
    now: Date,
  ): Promise<boolean>;
}
