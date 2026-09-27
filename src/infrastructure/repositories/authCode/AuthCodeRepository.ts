import { v7 as uuidv7 } from "uuid";

import {
  AuthCodeRecord,
  IAuthCodeRepository,
  IssuedCode,
} from "../../../domain/repositories/authCode/IAuthCodeRepository";
import { AuthCodePurpose } from "../../../shared/constants";
import { AuthCodeModel, IAuthCodeDocument } from "../../models/AuthCodeModel";

const toRecord = (doc: IAuthCodeDocument): AuthCodeRecord => ({
  id: doc._id,
  purpose: doc.purpose,
  toHash: doc.toHash,
  userId: doc.userId ?? null,
  codes: (doc.codes ?? []).map(({ codeHash, tokenHash, expiresAt }) => ({
    codeHash,
    tokenHash,
    expiresAt,
  })),
  attempts: doc.attempts ?? 0,
  issuedAt: doc.issuedAt ?? null,
});

export class AuthCodeRepository implements IAuthCodeRepository {
  async recordRequest(
    purpose: AuthCodePurpose,
    toHash: string,
    userId: string | null,
    expiresAt: Date,
  ): Promise<void> {
    await AuthCodeModel.updateOne(
      { purpose, toHash },
      {
        $set: { userId, expiresAt, attempts: 0 },
        $setOnInsert: { _id: uuidv7() },
      },
      { upsert: true },
    ).exec();
  }

  async issue(
    purpose: AuthCodePurpose,
    toHash: string,
    code: IssuedCode,
    keepLive: boolean,
    now: Date,
  ): Promise<void> {
    const kept = keepLive
      ? {
          $slice: [
            {
              $filter: {
                input: { $ifNull: ["$codes", []] },
                cond: { $gt: ["$$this.expiresAt", now] },
              },
            },
            -1,
          ],
        }
      : [];
    await AuthCodeModel.updateOne(
      { purpose, toHash },
      [
        {
          $set: {
            codes: { $concatArrays: [kept, [{ $literal: code }]] },
            attempts: 0,
            issuedAt: now,
            expiresAt: { $max: ["$expiresAt", code.expiresAt] },
          },
        },
      ],
      { updatePipeline: true },
    ).exec();
  }

  async countAttempt(
    purpose: AuthCodePurpose,
    toHash: string,
    maxAttempts: number,
  ): Promise<AuthCodeRecord | null> {
    const doc = await AuthCodeModel.findOneAndUpdate(
      { purpose, toHash, attempts: { $lt: maxAttempts } },
      { $inc: { attempts: 1 } },
      { returnDocument: "after" },
    ).lean();
    return doc ? toRecord(doc) : null;
  }

  async redeemCode(
    id: string,
    codeHash: string,
    now: Date,
  ): Promise<AuthCodeRecord | null> {
    const doc = await AuthCodeModel.findOneAndUpdate(
      { _id: id, codes: { $elemMatch: { codeHash, expiresAt: { $gt: now } } } },
      { $set: { codes: [] } },
      { returnDocument: "before" },
    ).lean();
    return doc ? toRecord(doc) : null;
  }

  async redeemToken(
    purpose: AuthCodePurpose,
    tokenHash: string,
    now: Date,
  ): Promise<AuthCodeRecord | null> {
    const doc = await AuthCodeModel.findOneAndUpdate(
      {
        purpose,
        codes: { $elemMatch: { tokenHash, expiresAt: { $gt: now } } },
      },
      { $set: { codes: [] } },
      { returnDocument: "before" },
    ).lean();
    return doc ? toRecord(doc) : null;
  }

  async find(
    purpose: AuthCodePurpose,
    toHash: string,
  ): Promise<AuthCodeRecord | null> {
    const doc = await AuthCodeModel.findOne({ purpose, toHash }).lean();
    return doc ? toRecord(doc) : null;
  }

  async findByLiveToken(
    purpose: AuthCodePurpose,
    tokenHash: string,
    now: Date,
  ): Promise<AuthCodeRecord | null> {
    const doc = await AuthCodeModel.findOne({
      purpose,
      codes: { $elemMatch: { tokenHash, expiresAt: { $gt: now } } },
    }).lean();
    return doc ? toRecord(doc) : null;
  }
}
