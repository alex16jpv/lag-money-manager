import { CategoryType, Color } from "./constants";
import { CategoryIcon } from "./icons";

interface DefaultCategory {
  name: string;
  icon: CategoryIcon;
  color: Color;
  type: CategoryType;
  // Stable identity: re-seed matches by seedKey, so renames don't duplicate.
  seedKey: string;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  // INCOME (3)
  {
    seedKey: "salary",
    name: "Salary",
    icon: "briefcase",
    color: "GREEN",
    type: "INCOME",
  },
  {
    seedKey: "business",
    name: "Business",
    icon: "coins",
    color: "TEAL",
    type: "INCOME",
  },
  {
    seedKey: "other-income",
    name: "Other Income",
    icon: "circle-plus",
    color: "LIME",
    type: "INCOME",
  },

  // EXPENSE (5)
  {
    seedKey: "housing",
    name: "Housing",
    icon: "house",
    color: "RED",
    type: "EXPENSE",
  },
  {
    seedKey: "food",
    name: "Food",
    icon: "utensils",
    color: "ORANGE",
    type: "EXPENSE",
  },
  {
    seedKey: "transportation",
    name: "Transportation",
    icon: "car",
    color: "RED",
    type: "EXPENSE",
  },
  {
    seedKey: "bills-services",
    name: "Bills & Services",
    icon: "zap",
    color: "AMBER",
    type: "EXPENSE",
  },
  {
    seedKey: "lifestyle",
    name: "Lifestyle",
    icon: "shopping-bag",
    color: "PURPLE",
    type: "EXPENSE",
  },

  // TRANSFER (2)
  {
    seedKey: "transfer",
    name: "Transfer",
    icon: "repeat",
    color: "GRAY",
    type: "TRANSFER",
  },
  {
    seedKey: "credit-card-payment",
    name: "Credit Card Payment",
    icon: "credit-card",
    color: "GRAY",
    type: "TRANSFER",
  },
];
