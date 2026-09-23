import mongoose, { Schema } from "mongoose";

import { NAME_COLLATION } from "../../shared/collation";
import { Color, COLORS, MODEL_NAMES } from "../../shared/constants";

export interface IContactDocument {
  _id: string;
  name: string;
  color?: Color;
  email?: string;
  userId: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new Schema<IContactDocument>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    color: { type: String, required: false, enum: Object.keys(COLORS) },
    email: { type: String, required: false, lowercase: true, trim: true },
    userId: { type: String, required: true },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ContactSchema.index({ userId: 1, _id: 1 });
// One active name per user; collation strength 2 folds case, accents stay distinct.
ContactSchema.index(
  { userId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { archivedAt: null },
    collation: NAME_COLLATION,
  },
);

// Change feed: keyset over (updatedAt, _id), archived rows included.
ContactSchema.index({ userId: 1, updatedAt: 1, _id: 1 });

export const ContactModel = mongoose.model<IContactDocument>(
  MODEL_NAMES.CONTACT,
  ContactSchema,
);
