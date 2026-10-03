import {
  ISignUpRepository,
  PendingSignUp,
} from "../../../domain/repositories/signUp/ISignUpRepository";
import { ISignUpDocument, SignUpModel } from "../../models/SignUpModel";

const duplicateKey = (err: unknown): boolean =>
  (err as { code?: number })?.code === 11000;

const toPending = (doc: ISignUpDocument): PendingSignUp => ({
  id: doc._id,
  toHash: doc.toHash,
  email: doc.email,
  name: doc.name,
  passwordHash: doc.passwordHash,
  timezone: doc.timezone,
  currency: doc.currency,
  locale: doc.locale,
  userId: doc.userId ?? null,
  signedInAt: doc.signedInAt ?? null,
  expiresAt: doc.expiresAt,
});

export class SignUpRepository implements ISignUpRepository {
  async replace(
    pending: Omit<PendingSignUp, "userId" | "signedInAt">,
  ): Promise<void> {
    const { id, ...fields } = pending;
    const write = async (): Promise<void> => {
      await SignUpModel.deleteMany({ toHash: pending.toHash }).exec();
      await SignUpModel.create({
        _id: id,
        ...fields,
        userId: null,
        signedInAt: null,
      });
    };
    try {
      await write();
    } catch (err) {
      // Two Create account for one address at once: the later one replaces the other.
      if (!duplicateKey(err)) throw err;
      await write();
    }
  }

  async findLive(id: string, now: Date): Promise<PendingSignUp | null> {
    const doc = await SignUpModel.findOne({
      _id: id,
      expiresAt: { $gt: now },
    }).lean();
    return doc ? toPending(doc) : null;
  }

  async claimCreation(
    id: string,
    userId: string,
    now: Date,
  ): Promise<PendingSignUp | null> {
    const doc = await SignUpModel.findOneAndUpdate(
      { _id: id, userId: null, expiresAt: { $gt: now } },
      { $set: { userId } },
      { returnDocument: "after" },
    ).lean();
    return doc ? toPending(doc) : null;
  }

  async releaseCreation(id: string, userId: string): Promise<void> {
    await SignUpModel.updateOne(
      { _id: id, userId },
      { $set: { userId: null } },
    ).exec();
  }

  async markSignedIn(id: string, now: Date): Promise<boolean> {
    const result = await SignUpModel.updateOne(
      { _id: id, signedInAt: null, userId: { $ne: null } },
      { $set: { signedInAt: now } },
    ).exec();
    return result.modifiedCount > 0;
  }
}
