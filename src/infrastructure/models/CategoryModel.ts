import mongoose, { Schema } from "mongoose";

import {
  CATEGORY_TYPES,
  CategoryType,
  Color,
  COLORS,
  MODEL_NAMES,
} from "../../shared/constants";
import { CATEGORY_ICONS, CategoryIcon } from "../../shared/icons";

export interface ICategoryDocument {
  _id: string;
  name: string;
  icon?: CategoryIcon;
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
    icon: { type: String, required: false, enum: CATEGORY_ICONS },
    color: { type: String, required: false, enum: Object.keys(COLORS) },
    type: { type: String, required: false, enum: Object.keys(CATEGORY_TYPES) },
    userId: { type: String, required: true },
    seedKey: { type: String, required: false },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

CategorySchema.index({ userId: 1, _id: 1 });
// One active category name per user (partial: excludes archived rows).
// Collation strength 2: case-insensitive ("Comida" = "comida"), accents
// still distinct. Display casing is preserved in the stored name.
CategorySchema.index(
  { userId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { archivedAt: null },
    collation: { locale: "es", strength: 2 },
  },
);

export const CategoryModel = mongoose.model<ICategoryDocument>(
  MODEL_NAMES.CATEGORY,
  CategorySchema,
);
