import { TxSession } from "../../../shared/unitOfWork";

export interface ISharedCounterpartyRepository {
  /** Writes one document per person, so two imputations over the same one cannot commit side by side. */
  claim(userId: string, keys: string[], session: TxSession): Promise<void>;
}
