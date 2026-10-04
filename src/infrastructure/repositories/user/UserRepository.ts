import { v7 as uuidv7 } from "uuid";

import {
  ConfirmDeadline,
  PendingEmailChange,
  RestoreLink,
  UndoLink,
  User,
} from "../../../domain/entities/User";
import {
  AddressHolder,
  IUserRepository,
} from "../../../domain/repositories/user/IUserRepository";
import { ApiError } from "../../../shared/errors";
import { Locale } from "../../../shared/locale";
import {
  buildPaginatedResult,
  pageQueryLimit,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import {
  IConfirmDeadlineDocument,
  IUserDocument,
  UserModel,
} from "../../models/UserModel";
import { ID_CURSOR_SORT, idCursorFilter } from "../keysetCursor";

const duplicateOn = (err: unknown, field: string): boolean => {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  return e?.code === 11000 && !!e.keyPattern && field in e.keyPattern;
};

const liveUndoLinks = (now: Date): Record<string, unknown> => ({
  $filter: {
    input: { $ifNull: ["$undoLinks", []] },
    cond: { $gt: ["$$this.expiresAt", now] },
  },
});

const liveRestoreLinks = (now: Date): Record<string, unknown> => ({
  $filter: {
    input: { $ifNull: ["$restoreLinks", []] },
    cond: { $gt: ["$$this.expiresAt", now] },
  },
});

const heldBy = (email: unknown, links: unknown): Record<string, unknown> => ({
  $setUnion: [[email], { $map: { input: links, in: "$$this.email" } }],
});

const bumpedTokenVersion = {
  $add: [{ $ifNull: ["$tokenVersion", 0] }, 1],
};

// Deleted and not erased yet; one deleted before keptUntil existed is kept until the nightly pass dates it.
const keptDeleted = (now: Date): Record<string, unknown> => ({
  deletedAt: { $ne: null },
  erasingAt: null,
  $or: [{ keptUntil: null }, { keptUntil: { $gt: now } }],
});

const reachable = (now: Date): Record<string, unknown> => ({
  erasingAt: null,
  $or: [
    { deletedAt: null },
    { deletedAt: { $ne: null }, keptUntil: null },
    { deletedAt: { $ne: null }, keptUntil: { $gt: now } },
  ],
});

const erasable = (now: Date): Record<string, unknown> => ({
  $or: [
    { erasingAt: { $type: "date" } },
    { deletedAt: { $ne: null }, keptUntil: { $lte: now } },
  ],
});

const notIn = (ids: string[]): Record<string, unknown> =>
  ids.length > 0 ? { _id: { $nin: ids } } : {};

type UserDocument = Omit<IUserDocument, "password" | "deletedAt"> & {
  password?: string;
  deletedAt?: Date | null;
};

const deadlineOf = (
  doc: IConfirmDeadlineDocument | null | undefined,
): ConfirmDeadline | null =>
  doc
    ? {
        day: doc.day,
        endsAt: doc.endsAt,
        remindedAt: doc.remindedAt ?? null,
        links: (doc.links ?? []).map((link) => ({
          email: link.email,
          tokenHash: link.tokenHash,
        })),
      }
    : null;

export class UserRepository implements IUserRepository {
  private toEntity(doc: UserDocument): User {
    return new User({
      id: doc._id,
      name: doc.name,
      email: doc.email,
      password: doc.password,
      tokenVersion: doc.tokenVersion,
      timezone: doc.timezone,
      currency: doc.currency,
      locale: doc.locale as Locale,
      theme: doc.theme
        ? { palette: doc.theme.palette, mode: doc.theme.mode }
        : null,
      lastLoginAt: doc.lastLoginAt,
      emailVerifiedAt: doc.emailVerifiedAt,
      confirmDeadline: deadlineOf(doc.confirmDeadline),
      emailChange: doc.emailChange
        ? {
            email: doc.emailChange.email,
            sentAt: doc.emailChange.sentAt,
            expiresAt: doc.emailChange.expiresAt,
          }
        : null,
      undoLinks: (doc.undoLinks ?? []).map((link) => ({
        email: link.email,
        tokenHash: link.tokenHash,
        expiresAt: link.expiresAt,
      })),
      devicesResetAt: doc.devicesResetAt,
      dataResetAt: doc.dataResetAt,
      deletedAt: doc.deletedAt,
      keptUntil: doc.keptUntil,
      restoreLinks: (doc.restoreLinks ?? []).map((link) => ({
        tokenHash: link.tokenHash,
        expiresAt: link.expiresAt,
      })),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  async getManyByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    const docs = await UserModel.find({ _id: { $in: ids }, deletedAt: null })
      .select("-password")
      .lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async getById(id: string): Promise<User | null> {
    const doc = await UserModel.findOne({ _id: id, deletedAt: null })
      .select("-password")
      .lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getByEmail(email: string): Promise<User | null> {
    const doc = await UserModel.findOne({ email, deletedAt: null }).lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getByIdWithPassword(id: string): Promise<User | null> {
    const doc = await UserModel.findOne({ _id: id, deletedAt: null }).lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getReachableByEmail(email: string, now: Date): Promise<User | null> {
    const doc = await UserModel.findOne({ email, ...reachable(now) }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async holderOf(
    email: string,
    now: Date,
    exceptUserId?: string,
  ): Promise<AddressHolder | null> {
    const owner = await UserModel.findOne({ email, ...reachable(now) })
      .select("-password")
      .lean();
    if (owner) {
      const user = this.toEntity(owner);
      return user.deletedAt
        ? { state: "deleted", user }
        : { state: "live", user };
    }
    const keeper = await UserModel.findOne({
      heldEmails: email,
      email: { $ne: email },
      undoLinks: { $elemMatch: { email, expiresAt: { $gt: now } } },
      erasingAt: null,
      ...(exceptUserId ? { _id: { $ne: exceptUserId } } : {}),
    })
      .select("-password")
      .lean();
    if (!keeper) return null;
    const user = this.toEntity(keeper);
    const freeAt = Math.max(
      ...user.undoLinks
        .filter((link) => link.email === email && link.expiresAt > now)
        .map((link) => link.expiresAt.getTime()),
    );
    return { state: "held", user, freeAt: new Date(freeAt) };
  }

  // A deleted account past its keptUntil gives its address up now, before the nightly pass erases it.
  private async releaseLapsedDeletion(email: string, now: Date): Promise<void> {
    const lapsed = await UserModel.findOne({
      email,
      deletedAt: { $ne: null },
      erasingAt: null,
      keptUntil: { $lte: now },
    })
      .select("_id")
      .lean();
    if (lapsed) await this.claimErasure(lapsed._id, now);
  }

  async recordLogin(id: string): Promise<void> {
    await UserModel.updateOne(
      { _id: id, deletedAt: null },
      { lastLoginAt: new Date() },
    );
  }

  async updateWithTokenBump(id: string, fields: Partial<User>): Promise<User> {
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: fields, $inc: { tokenVersion: 1 } },
      { new: true },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "User not found");
    }
    return this.toEntity(doc);
  }

  async forgetDevices(id: string, now: Date): Promise<User | null> {
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { devicesResetAt: now }, $inc: { tokenVersion: 1 } },
      { returnDocument: "after" },
    )
      .select("-password")
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  async resetPassword(
    id: string,
    passwordHash: string,
    now: Date,
  ): Promise<User | null> {
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, ...reachable(now) },
      [
        {
          $set: {
            password: { $literal: passwordHash },
            tokenVersion: bumpedTokenVersion,
            emailVerifiedAt: { $ifNull: ["$emailVerifiedAt", now] },
            emailChange: null,
            deletedAt: null,
            keptUntil: null,
            updatedAt: now,
          },
        },
      ],
      { returnDocument: "after", updatePipeline: true },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async markEmailVerified(
    id: string,
    email: string,
    now: Date,
  ): Promise<User | null> {
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, email, deletedAt: null, emailVerifiedAt: null },
      { $set: { emailVerifiedAt: now, updatedAt: now } },
      { returnDocument: "after", timestamps: false },
    )
      .select("-password")
      .lean();
    if (doc) return this.toEntity(doc);
    const current = await UserModel.findOne({ _id: id, email, deletedAt: null })
      .select("-password")
      .lean();
    return current?.emailVerifiedAt ? this.toEntity(current) : null;
  }

  async startEmailChange(
    id: string,
    change: PendingEmailChange,
  ): Promise<User | null> {
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { emailChange: change } },
      { returnDocument: "after", timestamps: false },
    )
      .select("-password")
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  async addUndoLink(id: string, link: UndoLink, now: Date): Promise<boolean> {
    const links = {
      $concatArrays: [liveUndoLinks(now), [{ $literal: link }]],
    };
    const result = await UserModel.updateOne(
      { _id: id, deletedAt: null },
      [{ $set: { undoLinks: links, heldEmails: heldBy("$email", links) } }],
      { timestamps: false, updatePipeline: true },
    ).exec();
    return result.matchedCount > 0;
  }

  async dropUndoLink(id: string, tokenHash: string): Promise<void> {
    await UserModel.updateOne(
      { _id: id },
      { $pull: { undoLinks: { tokenHash } } },
      { timestamps: false },
    ).exec();
  }

  async renewEmailChange(
    id: string,
    email: string,
    sentAt: Date,
    expiresAt: Date,
  ): Promise<User | null> {
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, deletedAt: null, "emailChange.email": email },
      {
        $set: {
          "emailChange.sentAt": sentAt,
          "emailChange.expiresAt": expiresAt,
        },
      },
      { returnDocument: "after", timestamps: false },
    )
      .select("-password")
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  async dropEmailChange(id: string, email?: string): Promise<void> {
    await UserModel.updateOne(
      { _id: id, ...(email ? { "emailChange.email": email } : {}) },
      { $set: { emailChange: null } },
      { timestamps: false },
    ).exec();
  }

  async applyEmailChange(
    id: string,
    email: string,
    now: Date,
  ): Promise<User | "taken" | null> {
    try {
      return await this.moveTo(id, email, now);
    } catch (err) {
      if (!duplicateOn(err, "email") && !duplicateOn(err, "heldEmails")) {
        throw err;
      }
    }
    await this.releaseLapsedHolds(email, now);
    await this.releaseLapsedDeletion(email, now);
    try {
      return await this.moveTo(id, email, now);
    } catch (err) {
      if (duplicateOn(err, "email") || duplicateOn(err, "heldEmails")) {
        return "taken";
      }
      throw err;
    }
  }

  private async moveTo(
    id: string,
    email: string,
    now: Date,
  ): Promise<User | null> {
    const links = liveUndoLinks(now);
    const doc = await UserModel.findOneAndUpdate(
      {
        _id: id,
        deletedAt: null,
        "emailChange.email": email,
        "emailChange.expiresAt": { $gt: now },
      },
      [
        {
          $set: {
            email: { $literal: email },
            emailVerifiedAt: now,
            emailChange: null,
            undoLinks: links,
            heldEmails: heldBy({ $literal: email }, links),
            tokenVersion: bumpedTokenVersion,
            updatedAt: now,
          },
        },
      ],
      { returnDocument: "after", updatePipeline: true },
    )
      .select("-password")
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  // An address whose undo links all lapsed is still in its old account's heldEmails until this lets it go.
  private async releaseLapsedHolds(email: string, now: Date): Promise<void> {
    const links = liveUndoLinks(now);
    await UserModel.updateMany(
      { heldEmails: email, email: { $ne: email } },
      [{ $set: { undoLinks: links, heldEmails: heldBy("$email", links) } }],
      { timestamps: false, updatePipeline: true },
    ).exec();
  }

  async getForUndo(id: string): Promise<User | null> {
    const doc = await UserModel.findOne({ _id: id, erasingAt: null })
      .select("-password")
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  async undoEmailChange(
    id: string,
    link: UndoLink,
    unusablePasswordHash: string,
    now: Date,
  ): Promise<User | null> {
    const earlier = {
      $filter: {
        input: liveUndoLinks(now),
        cond: { $lt: ["$$this.expiresAt", link.expiresAt] },
      },
    };
    const doc = await UserModel.findOneAndUpdate(
      {
        _id: id,
        erasingAt: null,
        undoLinks: {
          $elemMatch: {
            email: link.email,
            tokenHash: link.tokenHash,
            expiresAt: { $eq: link.expiresAt, $gt: now },
          },
        },
      },
      [
        {
          $set: {
            email: { $literal: link.email },
            emailVerifiedAt: now,
            emailChange: null,
            undoLinks: earlier,
            heldEmails: heldBy({ $literal: link.email }, earlier),
            deletedAt: null,
            keptUntil: null,
            password: { $literal: unusablePasswordHash },
            tokenVersion: bumpedTokenVersion,
            devicesResetAt: now,
            updatedAt: now,
          },
        },
      ],
      { returnDocument: "after", updatePipeline: true },
    )
      .select("-password")
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  async markDeleted(
    id: string,
    keptUntil: Date,
    link: RestoreLink,
    now: Date,
  ): Promise<User | null> {
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      [
        {
          $set: {
            deletedAt: now,
            keptUntil: { $literal: keptUntil },
            restoreLinks: {
              $concatArrays: [liveRestoreLinks(now), [{ $literal: link }]],
            },
            emailChange: null,
            tokenVersion: bumpedTokenVersion,
            updatedAt: now,
          },
        },
      ],
      { returnDocument: "after", updatePipeline: true },
    )
      .select("-password")
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  async restoreDeleted(id: string, now: Date): Promise<User | null> {
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, ...keptDeleted(now) },
      { $set: { deletedAt: null, keptUntil: null, updatedAt: now } },
      { returnDocument: "after", timestamps: false },
    )
      .select("-password")
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  async restoreFromLink(
    id: string,
    tokenHash: string,
    unusablePasswordHash: string,
    now: Date,
  ): Promise<User | null> {
    const doc = await UserModel.findOneAndUpdate(
      {
        _id: id,
        ...reachable(now),
        restoreLinks: { $elemMatch: { tokenHash, expiresAt: { $gt: now } } },
      },
      [
        {
          $set: {
            deletedAt: null,
            keptUntil: null,
            password: { $literal: unusablePasswordHash },
            tokenVersion: bumpedTokenVersion,
            devicesResetAt: now,
            emailChange: null,
            restoreLinks: {
              $filter: {
                input: liveRestoreLinks(now),
                cond: { $ne: ["$$this.tokenHash", tokenHash] },
              },
            },
            updatedAt: now,
          },
        },
      ],
      { returnDocument: "after", updatePipeline: true },
    )
      .select("-password")
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  async listUndatedDeletions(limit: number): Promise<User[]> {
    const docs = await UserModel.find({
      deletedAt: { $ne: null },
      keptUntil: null,
      erasingAt: null,
    })
      .select("-password")
      .sort({ deletedAt: 1 })
      .limit(limit)
      .lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async setKeptUntil(id: string, keptUntil: Date): Promise<void> {
    await UserModel.updateOne(
      { _id: id, deletedAt: { $ne: null }, keptUntil: null, erasingAt: null },
      { $set: { keptUntil } },
      { timestamps: false },
    ).exec();
  }

  async listErasable(
    now: Date,
    limit: number,
    exceptIds: string[],
  ): Promise<string[]> {
    const docs = await UserModel.find({
      ...erasable(now),
      ...notIn(exceptIds),
    })
      .select("_id")
      .limit(limit)
      .lean();
    return docs.map((doc) => doc._id);
  }

  async claimErasure(id: string, now: Date): Promise<boolean> {
    const result = await UserModel.updateOne(
      { _id: id, ...erasable(now) },
      [
        {
          $set: {
            erasingAt: { $ifNull: ["$erasingAt", now] },
            email: { $concat: ["$_id", "@erasing.invalid"] },
            heldEmails: "$$REMOVE",
            undoLinks: [],
            restoreLinks: [],
            emailChange: null,
            tokenVersion: bumpedTokenVersion,
          },
        },
      ],
      { timestamps: false, updatePipeline: true },
    ).exec();
    return result.matchedCount > 0;
  }

  async eraseForGood(id: string): Promise<void> {
    await UserModel.deleteOne({ _id: id, erasingAt: { $ne: null } }).exec();
  }

  async listWithoutDeadline(
    limit: number,
    exceptIds: string[],
  ): Promise<User[]> {
    const docs = await UserModel.find({
      emailVerifiedAt: null,
      confirmDeadline: null,
      deletedAt: null,
      erasingAt: null,
      ...notIn(exceptIds),
    })
      .select("-password")
      .sort({ _id: 1 })
      .limit(limit)
      .lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async startConfirmDeadline(
    id: string,
    email: string,
    deadline: ConfirmDeadline,
  ): Promise<boolean> {
    const result = await UserModel.updateOne(
      {
        _id: id,
        email,
        emailVerifiedAt: null,
        confirmDeadline: null,
        deletedAt: null,
      },
      { $set: { confirmDeadline: deadline } },
      { timestamps: false },
    ).exec();
    return result.matchedCount > 0;
  }

  async listDueReminders(
    now: Date,
    endsBy: Date,
    limit: number,
    exceptIds: string[],
  ): Promise<User[]> {
    const docs = await UserModel.find({
      emailVerifiedAt: null,
      "confirmDeadline.endsAt": { $gt: now, $lte: endsBy },
      "confirmDeadline.remindedAt": null,
      deletedAt: null,
      erasingAt: null,
      ...notIn(exceptIds),
    })
      .select("-password")
      .limit(limit)
      .lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async markReminded(
    id: string,
    link: { email: string; tokenHash: string },
    now: Date,
  ): Promise<boolean> {
    const result = await UserModel.updateOne(
      {
        _id: id,
        email: link.email,
        emailVerifiedAt: null,
        "confirmDeadline.remindedAt": null,
      },
      {
        $set: { "confirmDeadline.remindedAt": now },
        $push: { "confirmDeadline.links": link },
      },
      { timestamps: false },
    ).exec();
    return result.matchedCount > 0;
  }

  async getAll(pagination: PaginationParams): Promise<PaginatedResult<User>> {
    const { limit, offset, cursor } = pagination;
    const baseFilter: Record<string, unknown> = { deletedAt: null };
    const filter = cursor
      ? await idCursorFilter(UserModel, baseFilter, cursor)
      : baseFilter;

    const [docs, total] = await Promise.all([
      UserModel.find(filter)
        .sort(ID_CURSOR_SORT)
        .skip(cursor ? 0 : offset)
        .limit(pageQueryLimit(limit))
        .lean(),
      UserModel.countDocuments({ deletedAt: null }),
    ]);

    return buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
  }

  async create(user: Partial<User>): Promise<User> {
    const fields = {
      _id: user.id ?? uuidv7(),
      ...user,
      heldEmails: user.email ? [user.email] : undefined,
    };
    try {
      return this.toEntity(await UserModel.create(fields));
    } catch (err) {
      if (
        !user.email ||
        (!duplicateOn(err, "heldEmails") && !duplicateOn(err, "email"))
      ) {
        throw err;
      }
    }
    const email = user.email.trim().toLowerCase();
    const now = new Date();
    await this.releaseLapsedHolds(email, now);
    await this.releaseLapsedDeletion(email, now);
    return this.toEntity(await UserModel.create(fields));
  }

  async update(id: string, user: Partial<User>): Promise<User> {
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      user,
      { new: true },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "User not found");
    }
    return this.toEntity(doc);
  }
}
