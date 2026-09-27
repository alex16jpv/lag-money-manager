import {
  IEmailDeliveryRepository,
  NewEmailDelivery,
} from "../../../domain/repositories/emailDelivery/IEmailDeliveryRepository";
import { EmailDeliveryModel } from "../../models/EmailDeliveryModel";

export class EmailDeliveryRepository implements IEmailDeliveryRepository {
  async record(delivery: NewEmailDelivery): Promise<void> {
    await EmailDeliveryModel.create(delivery);
  }
}
