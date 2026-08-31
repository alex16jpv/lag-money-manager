import mongoose, { Schema } from "mongoose";

import { CATEGORY_TYPES, CategoryType,Color, COLORS, MODEL_NAMES } from "../../shared/constants";

export interface ICategoryDocument {
  _id: string;
  name: string;
  emoji?: string;
  color?: Color;
  type?: CategoryType;
  userId: string;
  seedKey?: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategoryDocument>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    emoji: { type: String, required: false },
    color: { type: String, required: false, enum: Object.keys(COLORS) },
    type: { type: String, required: false, enum: Object.keys(CATEGORY_TYPES) },
    userId: { type: String, required: true },
    seedKey: { type: String, required: false },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

CategorySchema.index({ userId: 1, _id: 1 });
// One active category name per user (partial: excludes soft-deleted rows).
CategorySchema.index(
  { userId: 1, name: 1 },
  { unique: true, partialFilterExpression: { archivedAt: null } },
);

export const CategoryModel = mongoose.model<ICategoryDocument>(
  MODEL_NAMES.CATEGORY,
  CategorySchema,
);
