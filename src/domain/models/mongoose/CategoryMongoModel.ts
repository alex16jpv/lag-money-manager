import mongoose, { Schema } from "mongoose";
import { MODEL_NAMES } from "../../../shared/constants";

export interface ICategoryDocument {
  _id: string;
  name: string;
  emoji?: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategoryDocument>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    emoji: { type: String, required: false },
    userId: { type: String, required: true },
  },
  { timestamps: true },
);

CategorySchema.index({ userId: 1, _id: 1 });

export const CategoryMongoModel = mongoose.model<ICategoryDocument>(
  MODEL_NAMES.CATEGORY,
  CategorySchema,
);
