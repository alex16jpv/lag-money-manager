import { v7 as uuidv7 } from "uuid";

import {
  FreshStartDetails,
  KeepOrStartFresh,
  PendingEmailChange,
  User,
} from "../../../domain/entities/User";
import { IUserRepository } from "../../../domain/repositories/user/IUserRepository";
import { ApiError } from "../../../shared/errors";
import { Locale } from "../../../shared/locale";
import {
  buildPaginatedResult,
  pageQueryLimit,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { UserModel } from "../../models/UserModel";
import { ID_CURSOR_SORT, idCursorFilter } from "../keysetCursor";

export class UserRepository implements IUserRepository {
  private toEntity(doc: {
    _id: string;
    name: string;
    email: string;
    password?: string;
    tokenVersion?: number;
    timezone?: string;
    currency?: string;
    locale?: Locale;
    lastLoginAt?: Date | null;
    emailVerifiedAt?: Date | null;
    firstVerifiedAt?: Date | null;
    emailChangedAt?: Date | null;
    emailChange?: PendingEmailChange | null;
    keepOrStartFresh?: KeepOrStartFresh | null;
    dataResetAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): User {
    return new User({
      id: doc._id,
      name: doc.name,
      email: doc.email,
      password: doc.password,
      tokenVersion: doc.tokenVersion,
      timezone: doc.timezone,
      currency: doc.currency,
      locale: doc.locale,
      lastLoginAt: doc.lastLoginAt,
      emailVerifiedAt: doc.emailVerifiedAt,
      firstVerifiedAt: doc.firstVerifiedAt,
      emailChangedAt: doc.emailChangedAt,
      emailChange: doc.emailChange
        ? {
            email: doc.emailChange.email,
            sentAt: doc.emailChange.sentAt,
            expiresAt: doc.emailChange.expiresAt,
          }
        : null,
      keepOrStartFresh: doc.keepOrStartFresh
        ? {
            askedAt: doc.keepOrStartFresh.askedAt,
            accounts: doc.keepOrStartFresh.accounts,
            transactions: doc.keepOrStartFresh.transactions,
            startFresh: doc.keepOrStartFresh.startFresh ?? null,
          }
        : null,
      dataResetAt: doc.dataResetAt,
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

  async bumpTokenVersion(id: string): Promise<void> {
    await UserModel.updateOne(
      { _id: id, deletedAt: null },
      { $inc: { tokenVersion: 1 } },
    );
  }

  async getDeletedByEmail(email: string): Promise<User | null> {
    const doc = await UserModel.findOne({
      email,
      deletedAt: { $ne: null },
      erasingAt: null,
    }).lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async resetPassword(
    id: string,
    passwordHash: string,
    question: { accounts: number; transactions: number } | null,
    now: Date,
  ): Promise<User | null> {
    const neverConfirmed = {
      $eq: [{ $ifNull: ["$emailVerifiedAt", null] }, null],
    };
    const keepQuestion = { $ifNull: ["$keepOrStartFresh", null] };
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      [
        {
          $set: {
            password: { $literal: passwordHash },
            tokenVersion: { $add: [{ $ifNull: ["$tokenVersion", 0] }, 1] },
            keepOrStartFresh: question
              ? {
                  $cond: [
                    neverConfirmed,
                    {
                      $ifNull: [
                        "$keepOrStartFresh",
                        {
                          $literal: {
                            askedAt: now,
                            ...question,
                            startFresh: null,
                          },
                        },
                      ],
                    },
                    keepQuestion,
                  ],
                }
              : keepQuestion,
            emailVerifiedAt: { $ifNull: ["$emailVerifiedAt", now] },
            firstVerifiedAt: { $ifNull: ["$firstVerifiedAt", now] },
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
      [
        {
          $set: {
            emailVerifiedAt: now,
            firstVerifiedAt: { $ifNull: ["$firstVerifiedAt", now] },
            updatedAt: now,
          },
        },
      ],
      { returnDocument: "after", updatePipeline: true },
    )
      .select("-password")
      .lean();
    if (doc) return this.toEntity(doc);
    const current = await UserModel.findOne({ _id: id, email, deletedAt: null })
      .select("-password")
      .lean();
    return current?.emailVerifiedAt ? this.toEntity(current) : null;
  }

  async emailInUse(email: string): Promise<boolean> {
    return (await UserModel.exists({ email })) !== null;
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
              firstVerifiedAt: { $ifNull: ["$firstVerifiedAt", now] },
              emailChangedAt: now,
              emailChange: null,
              tokenVersion: { $add: [{ $ifNull: ["$tokenVersion", 0] }, 1] },
              updatedAt: now,
            },
          },
        ],
        { returnDocument: "after", updatePipeline: true },
      )
        .select("-password")
        .lean();
      return doc ? this.toEntity(doc) : null;
    } catch (err) {
      const e = err as { code?: number; keyPattern?: Record<string, unknown> };
      if (e.code === 11000 && !!e.keyPattern && "email" in e.keyPattern) {
        return "taken";
      }
      throw err;
    }
  }

  async getForErasure(id: string): Promise<User | null> {
    const doc = await UserModel.findOne({
      _id: id,
      emailVerifiedAt: null,
      firstVerifiedAt: null,
    })
      .select("-password")
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  async claimErasure(
    id: string,
    email: string,
    tokenIssuedAt: Date,
    now: Date,
  ): Promise<User | null> {
    const doc = await UserModel.findOneAndUpdate(
      {
        _id: id,
        email,
        emailVerifiedAt: null,
        firstVerifiedAt: null,
        $or: [
          { emailChangedAt: null },
          { emailChangedAt: { $lte: tokenIssuedAt } },
        ],
      },
      [
        {
          $set: {
            deletedAt: { $ifNull: ["$deletedAt", now] },
            erasingAt: { $ifNull: ["$erasingAt", now] },
            tokenVersion: { $add: [{ $ifNull: ["$tokenVersion", 0] }, 1] },
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

  async eraseForGood(id: string): Promise<void> {
    await UserModel.deleteOne({ _id: id, erasingAt: { $ne: null } }).exec();
  }

  async keepEverything(id: string, now: Date): Promise<User | null> {
    const doc = await UserModel.findOneAndUpdate(
      {
        _id: id,
        deletedAt: null,
        keepOrStartFresh: { $ne: null },
        "keepOrStartFresh.startFresh": null,
      },
      { $set: { keepOrStartFresh: null, updatedAt: now } },
      { returnDocument: "after", timestamps: false },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async chooseStartFresh(
    id: string,
    details: FreshStartDetails,
    now: Date,
    leaseMs: number,
  ): Promise<User | null> {
    const doc = await UserModel.findOneAndUpdate(
      {
        _id: id,
        deletedAt: null,
        keepOrStartFresh: { $ne: null },
        $or: [
          { "keepOrStartFresh.startFresh": null },
          { "keepOrStartFresh.startFresh.claimedUntil": { $lte: now } },
        ],
      },
      {
        $set: {
          "keepOrStartFresh.startFresh": {
            ...details,
            claimedUntil: new Date(now.getTime() + leaseMs),
          },
          updatedAt: now,
        },
      },
      { returnDocument: "after", timestamps: false },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async releaseStartFresh(id: string, now: Date): Promise<void> {
    await UserModel.updateOne(
      { _id: id, "keepOrStartFresh.startFresh": { $ne: null } },
      { $set: { "keepOrStartFresh.startFresh.claimedUntil": now } },
      { timestamps: false },
    ).exec();
  }

  async finishStartFresh(id: string, now: Date): Promise<User | null> {
    const chosen = "$keepOrStartFresh.startFresh";
    const doc = await UserModel.findOneAndUpdate(
      {
        _id: id,
        deletedAt: null,
        "keepOrStartFresh.startFresh": { $ne: null },
      },
      [
        {
          $set: {
            name: `${chosen}.name`,
            locale: `${chosen}.locale`,
            currency: `${chosen}.currency`,
            timezone: `${chosen}.timezone`,
            keepOrStartFresh: null,
            dataResetAt: now,
            updatedAt: now,
          },
        },
      ],
      { returnDocument: "after", updatePipeline: true },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async reactivate(
    id: string,
    updates: Pick<User, "name" | "password"> &
      Partial<Pick<User, "timezone" | "locale">>,
  ): Promise<User> {
    // tokenVersion bump keeps any pre-deletion refresh tokens revoked.
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, deletedAt: { $ne: null }, erasingAt: null },
      { $set: { ...updates, deletedAt: null }, $inc: { tokenVersion: 1 } },
      { new: true },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "User not found");
    }
    return this.toEntity(doc);
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
    const id = user.id ?? uuidv7();
    const doc = await UserModel.create({ _id: id, ...user });
    return this.toEntity(doc);
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

  async delete(id: string): Promise<void> {
    // The access token still survives its remaining ~15 min: the middleware is stateless by design.
    const doc = await UserModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date() }, $inc: { tokenVersion: 1 } },
      { new: true },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "User not found");
    }
  }
}
