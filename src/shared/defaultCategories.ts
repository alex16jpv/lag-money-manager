import { CategoryType, Color } from "./constants";

interface DefaultCategory {
  name: string;
  emoji: string;
  color: Color;
  type: CategoryType;
  // Stable identity: re-seed matches by seedKey, so renames don't duplicate.
  seedKey: string;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  // INCOME (3)
  { seedKey: "salary", name: "Salary", emoji: "💼", color: "GREEN", type: "INCOME" },
  { seedKey: "business", name: "Business", emoji: "💰", color: "TEAL", type: "INCOME" },
  { seedKey: "other-income", name: "Other Income", emoji: "➕", color: "LIME", type: "INCOME" },

  // EXPENSE (5)
  { seedKey: "housing", name: "Housing", emoji: "🏠", color: "RED", type: "EXPENSE" },
  { seedKey: "food", name: "Food", emoji: "🍽️", color: "ORANGE", type: "EXPENSE" },
  { seedKey: "transportation", name: "Transportation", emoji: "🚗", color: "RED", type: "EXPENSE" },
  { seedKey: "bills-services", name: "Bills & Services", emoji: "⚡", color: "AMBER", type: "EXPENSE" },
  { seedKey: "lifestyle", name: "Lifestyle", emoji: "🛍️", color: "PURPLE", type: "EXPENSE" },

  // TRANSFER (2)
  { seedKey: "transfer", name: "Transfer", emoji: "🔁", color: "GRAY", type: "TRANSFER" },
  { seedKey: "credit-card-payment", name: "Credit Card Payment", emoji: "💳", color: "GRAY", type: "TRANSFER" },
];
