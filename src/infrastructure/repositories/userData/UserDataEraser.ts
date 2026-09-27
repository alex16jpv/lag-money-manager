import { IUserDataEraser } from "../../../domain/repositories/userData/IUserDataEraser";
import {
  AUTH_CODE_PURPOSES,
  INVITATION_STATUSES,
} from "../../../shared/constants";
import { AccountModel } from "../../models/AccountModel";
import { AuthCodeModel } from "../../models/AuthCodeModel";
import { BudgetModel } from "../../models/BudgetModel";
import { CategoryModel } from "../../models/CategoryModel";
import { ContactModel } from "../../models/ContactModel";
import { RefreshSessionModel } from "../../models/RefreshSessionModel";
import { SharedCounterpartyModel } from "../../models/SharedCounterpartyModel";
import { SharedExpenseModel } from "../../models/SharedExpenseModel";
import { SharedGroupModel } from "../../models/SharedGroupModel";
import { SharedInvitationModel } from "../../models/SharedInvitationModel";
import { SharedSettlementModel } from "../../models/SharedSettlementModel";
import { TransactionModel } from "../../models/TransactionModel";

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const LIVE = [INVITATION_STATUSES.PENDING, INVITATION_STATUSES.ACCEPTED];

export class UserDataEraser implements IUserDataEraser {
  async eraseAll(userId: string): Promise<void> {
    await this.eraseDependents(userId);
    await SharedGroupModel.deleteMany({ userId }).exec();
    await ContactModel.deleteMany({ userId }).exec();
    await AccountModel.deleteMany({ userId }).exec();
    await CategoryModel.deleteMany({ userId }).exec();
    // Again: a write that landed before its account, category or group went would point at nothing.
    await this.eraseDependents(userId);

    const retired = `retired:${userId}`;
    const now = new Date();
    // Kept for the guests, whose copies learn the end from them, but out of this account's own feed.
    await SharedInvitationModel.updateMany(
      { userId },
      [
        {
          $set: {
            userId: retired,
            withdrawnAt: {
              $cond: [{ $in: ["$status", LIVE] }, now, "$withdrawnAt"],
            },
            status: {
              $cond: [
                { $in: ["$status", LIVE] },
                INVITATION_STATUSES.WITHDRAWN,
                "$status",
              ],
            },
            open: "$$REMOVE",
            updatedAt: now,
          },
        },
      ],
      { updatePipeline: true },
    ).exec();
    // The ones it answered stay with their owners, who read LEFT or DECLINED; this account no longer finds them.
    await SharedInvitationModel.updateMany(
      { inviteeId: userId },
      { $set: { inviteeId: retired } },
    ).exec();
  }

  async eraseAccount(userId: string, toHash: string): Promise<void> {
    await this.eraseAll(userId);
    await RefreshSessionModel.deleteMany({ userId }).exec();
    await AuthCodeModel.deleteMany({
      purpose: { $in: Object.values(AUTH_CODE_PURPOSES) },
      toHash,
    }).exec();
  }

  private async eraseDependents(userId: string): Promise<void> {
    await TransactionModel.deleteMany({ userId }).exec();
    await SharedSettlementModel.deleteMany({ userId }).exec();
    await SharedExpenseModel.deleteMany({ userId }).exec();
    await SharedCounterpartyModel.deleteMany({
      _id: { $regex: `^${escapeRegExp(userId)}:` },
    }).exec();
    await BudgetModel.deleteMany({ userId }).exec();
  }
}
