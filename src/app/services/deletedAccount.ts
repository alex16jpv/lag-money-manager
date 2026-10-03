import { User } from "../../domain/entities/User";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { dayAfter, DELETED_ACCOUNT_KEPT_DAYS } from "../../shared/accountDays";
import { dayKeyOf, lastDayKeyOf } from "../../shared/dayKey";
import { DeletedAccountView } from "../dtos/UserDTO";

type Deleted = User & { deletedAt: Date };
type Dated = Deleted & { keptUntil: Date };

const isDeleted = (user: User): user is Deleted => user.deletedAt !== null;

export const keptUntilFrom = (now: Date, timezone: string): Date =>
  dayAfter(now, DELETED_ACCOUNT_KEPT_DAYS, timezone).endsAt;

// An account deleted before keptUntil existed gets its 30 days from the first time anything reaches it (the owner's decision of 2026-10-03).
export async function datedDeletion(
  users: Pick<IUserRepository, "setKeptUntil">,
  user: User,
  now: Date,
): Promise<Dated> {
  if (!isDeleted(user)) throw new Error("Only a deleted account has a date");
  if (user.keptUntil) return user as Dated;
  const keptUntil = keptUntilFrom(now, user.timezone);
  await users.setKeptUntil(user.id, keptUntil);
  return Object.assign(user, { keptUntil });
}

export const deletedDays = (user: Dated): DeletedAccountView => ({
  deletedOn: dayKeyOf(user.deletedAt, user.timezone),
  keptUntil: lastDayKeyOf(user.keptUntil, user.timezone),
});
