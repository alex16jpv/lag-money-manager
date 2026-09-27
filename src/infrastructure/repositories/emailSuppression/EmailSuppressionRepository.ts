import {
  IEmailSuppressionRepository,
  NewEmailSuppression,
} from "../../../domain/repositories/emailSuppression/IEmailSuppressionRepository";
import { EmailSuppressionModel } from "../../models/EmailSuppressionModel";

const ACTIVE = {
  $and: [
    { $ne: [{ $type: "$suppressedAt" }, "missing"] },
    { $eq: [{ $ifNull: ["$liftedAt", null] }, null] },
  ],
};

const keepOr = (field: string, value: unknown): { $cond: unknown[] } => ({
  $cond: [ACTIVE, `$${field}`, { $literal: value }],
});

export class EmailSuppressionRepository implements IEmailSuppressionRepository {
  async isSuppressed(toHash: string): Promise<boolean> {
    const found = await EmailSuppressionModel.exists({
      toHash,
      liftedAt: null,
    });
    return found !== null;
  }

  async suppress(suppression: NewEmailSuppression): Promise<boolean> {
    const before = await EmailSuppressionModel.findOneAndUpdate(
      { toHash: suppression.toHash },
      [
        {
          $set: {
            reason: keepOr("reason", suppression.reason),
            provider: keepOr("provider", suppression.provider),
            detail: keepOr("detail", suppression.detail),
            suppressedAt: keepOr("suppressedAt", suppression.at),
            liftedAt: null,
          },
        },
      ],
      { upsert: true, returnDocument: "before", updatePipeline: true },
    ).lean();
    return before === null || before.liftedAt !== null;
  }

  async lift(toHash: string): Promise<boolean> {
    const result = await EmailSuppressionModel.updateOne(
      { toHash, liftedAt: null },
      { $set: { liftedAt: new Date() } },
    ).exec();
    return result.modifiedCount > 0;
  }
}
