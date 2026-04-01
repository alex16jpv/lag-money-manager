import { CategoryType, Color } from "./constants";

interface DefaultCategory {
  name: string;
  emoji: string;
  color: Color;
  type: CategoryType;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  // Income
  { name: "Salary", emoji: "💼", color: "GREEN", type: "INCOME" },
  { name: "Bonus", emoji: "🎁", color: "GREEN", type: "INCOME" },
  { name: "Freelance", emoji: "🧑‍💻", color: "TEAL", type: "INCOME" },
  { name: "Business", emoji: "💰", color: "TEAL", type: "INCOME" },
  { name: "Investment", emoji: "📈", color: "GREEN", type: "INCOME" },
  { name: "Rental", emoji: "🏠", color: "LIME", type: "INCOME" },
  { name: "Interest", emoji: "🏦", color: "GREEN", type: "INCOME" },
  { name: "Dividends", emoji: "💵", color: "GREEN", type: "INCOME" },
  { name: "Gift", emoji: "🎉", color: "TEAL", type: "INCOME" },
  { name: "Refund", emoji: "🔄", color: "LIME", type: "INCOME" },
  { name: "Other Income", emoji: "➕", color: "LIME", type: "INCOME" },

  // Expenses
  { name: "Housing", emoji: "🏠", color: "RED", type: "EXPENSE" },
  { name: "Utilities", emoji: "⚡", color: "AMBER", type: "EXPENSE" },
  { name: "Groceries", emoji: "🛒", color: "ORANGE", type: "EXPENSE" },
  { name: "Dining", emoji: "🍽️", color: "ORANGE", type: "EXPENSE" },
  { name: "Transportation", emoji: "🚗", color: "RED", type: "EXPENSE" },
  { name: "Fuel", emoji: "⛽", color: "RED", type: "EXPENSE" },
  { name: "Insurance", emoji: "🛡️", color: "PURPLE", type: "EXPENSE" },
  { name: "Healthcare", emoji: "🏥", color: "RED", type: "EXPENSE" },
  { name: "Education", emoji: "🎓", color: "PURPLE", type: "EXPENSE" },
  { name: "Shopping", emoji: "🛍️", color: "PINK", type: "EXPENSE" },
  { name: "Entertainment", emoji: "🎬", color: "PURPLE", type: "EXPENSE" },
  { name: "Subscriptions", emoji: "📱", color: "PURPLE", type: "EXPENSE" },
  { name: "Travel", emoji: "✈️", color: "BLUE", type: "EXPENSE" },
  { name: "Personal Care", emoji: "💇", color: "ROSE", type: "EXPENSE" },
  { name: "Fitness", emoji: "🏋️", color: "RED", type: "EXPENSE" },
  { name: "Taxes", emoji: "🧾", color: "BROWN", type: "EXPENSE" },
  { name: "Debt", emoji: "💳", color: "BROWN", type: "EXPENSE" },
  { name: "Charity", emoji: "❤️", color: "RED", type: "EXPENSE" },
  { name: "Kids", emoji: "👶", color: "ROSE", type: "EXPENSE" },
  { name: "Pets", emoji: "🐶", color: "ORANGE", type: "EXPENSE" },
  { name: "Miscellaneous", emoji: "📦", color: "GRAY", type: "EXPENSE" },

  // Transfers
  { name: "Savings", emoji: "💰", color: "BLUE", type: "TRANSFER" },
  { name: "Investment Transfer", emoji: "📊", color: "CYAN", type: "TRANSFER" },
  { name: "Credit Card Payment", emoji: "💳", color: "GRAY", type: "TRANSFER" },
  { name: "Loan Payment", emoji: "🏦", color: "GRAY", type: "TRANSFER" },
  { name: "Internal Transfer", emoji: "🔁", color: "GRAY", type: "TRANSFER" },
];
