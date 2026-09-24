import mongoose, { Schema } from "mongoose";

import { MODEL_NAMES } from "../../shared/constants";

export interface ISharedCounterpartyDocument {
  _id: string; // `${userId}:${counterpartyKey}`
  imputations: number;
}

const SharedCounterpartySchema = new Schema<ISharedCounterpartyDocument>(
  {
    _id: { type: String, required: true },
    imputations: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export const SharedCounterpartyModel =
  mongoose.model<ISharedCounterpartyDocument>(
    MODEL_NAMES.SHARED_COUNTERPARTY,
    SharedCounterpartySchema,
  );
