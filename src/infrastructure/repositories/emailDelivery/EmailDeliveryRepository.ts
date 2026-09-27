import {
  EmailDeliveryReport,
  IEmailDeliveryRepository,
  NewEmailDelivery,
} from "../../../domain/repositories/emailDelivery/IEmailDeliveryRepository";
import { EmailDeliveryModel } from "../../models/EmailDeliveryModel";

export class EmailDeliveryRepository implements IEmailDeliveryRepository {
  async record(delivery: NewEmailDelivery): Promise<void> {
    await EmailDeliveryModel.create(delivery);
  }

  async report(report: EmailDeliveryReport): Promise<void> {
    await EmailDeliveryModel.updateOne(
      {
        provider: report.provider,
        messageId: report.messageId,
        status: { $in: report.from },
      },
      {
        $set: {
          status: report.status,
          reportedAt: report.at,
          report: report.detail,
        },
      },
    ).exec();
  }
}
