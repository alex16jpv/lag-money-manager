import { ISharedCounterpartyRepository } from "../../../domain/repositories/sharedCounterparty/ISharedCounterpartyRepository";
import { TxSession } from "../../../shared/unitOfWork";
import { SharedCounterpartyModel } from "../../models/SharedCounterpartyModel";

export class SharedCounterpartyRepository implements ISharedCounterpartyRepository {
  async claim(
    userId: string,
    keys: string[],
    session: TxSession,
  ): Promise<void> {
    if (keys.length === 0) return;
    await SharedCounterpartyModel.bulkWrite(
      keys.map((key) => ({
        updateOne: {
          filter: { _id: `${userId}:${key}` },
          update: { $inc: { imputations: 1 } },
          upsert: true,
        },
      })),
      { session },
    );
  }
}
