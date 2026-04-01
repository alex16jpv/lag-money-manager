import mongoose, { Schema } from "mongoose";
import { TRANSACTION_TYPES, COLORS, MODEL_NAMES, Color, CategoryType } from "../../../shared/constants";

export interface ICategoryDocument {
  _id: string;
  name: string;
  emoji?: string;
  color?: Color;
  type?: CategoryType;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategoryDocument>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    emoji: { type: String, required: false },
    color: { type: String, required: false, enum: Object.keys(COLORS) },
    type: { type: String, required: false, enum: Object.keys(TRANSACTION_TYPES) },
    userId: { type: String, required: true },
  },
  { timestamps: true },
);

CategorySchema.index({ userId: 1, _id: 1 });

export const CategoryMongoModel = mongoose.model<ICategoryDocument>(
  MODEL_NAMES.CATEGORY,
  CategorySchema,
);
