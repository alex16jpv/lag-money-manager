import { TxSession } from "../../../shared/unitOfWork";
import { FreshStartDetails, User } from "../../entities/User";
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
