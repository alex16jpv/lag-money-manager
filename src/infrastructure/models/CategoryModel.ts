import mongoose, { Schema } from "mongoose";

import { NAME_COLLATION } from "../../shared/collation";
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
// One active name per user; collation strength 2 folds case, accents stay distinct.
CategorySchema.index(
  { userId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { archivedAt: null },
    collation: NAME_COLLATION,
  },
);

// Change feed: keyset over (updatedAt, _id), archived and deleted rows included.
CategorySchema.index({ userId: 1, updatedAt: 1, _id: 1 });

export const CategoryModel = mongoose.model<ICategoryDocument>(
  MODEL_NAMES.CATEGORY,
  CategorySchema,
);
