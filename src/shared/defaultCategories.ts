import { CategoryType, Color } from "./constants";

interface DefaultCategory {
  name: string;
  emoji: string;
  color: Color;
  type: CategoryType;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  // INCOME (3)
  { name: "Salary", emoji: "💼", color: "GREEN", type: "INCOME" },
  { name: "Business", emoji: "💰", color: "TEAL", type: "INCOME" },
  { name: "Other Income", emoji: "➕", color: "LIME", type: "INCOME" },

  // EXPENSE (5)
  { name: "Housing", emoji: "🏠", color: "RED", type: "EXPENSE" },
  { name: "Food", emoji: "🍽️", color: "ORANGE", type: "EXPENSE" },
  { name: "Transportation", emoji: "🚗", color: "RED", type: "EXPENSE" },
  { name: "Bills & Services", emoji: "⚡", color: "AMBER", type: "EXPENSE" },
  { name: "Lifestyle", emoji: "🛍️", color: "PURPLE", type: "EXPENSE" },

  // TRANSFER (2)
  { name: "Transfer", emoji: "🔁", color: "GRAY", type: "TRANSFER" },
  { name: "Credit Card Payment", emoji: "💳", color: "GRAY", type: "TRANSFER" },
];
