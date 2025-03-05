export const DB_TYPES = {
  SEQ: "SEQ",
  MONGO: "MONGO",
  LOCAL_STORAGE: "LOCAL_STORAGE",
};

export const MODEL_NAMES = {
  USER: "User",
  ACCOUNT: "Account",
  TRANSACTION: "Transaction",
  BUDGET: "Budget",
  CATEGORY: "Category",
};

export const ACCOUNT_TYPES = {
  CASH: "CASH",
  ACCOUNT: "ACCOUNT",
  CARD: "CARD",
  DEBIT_CARD: "DEBIT_CARD",
  SAVINGS: "SAVINGS",
  INVESTMENT: "INVESTMENT",
  OVERDRAFT: "OVERDRAFT",
  LOAN: "LOAN",
  OTHER: "OTHER",
};

export const TRANSACTION_TYPES = {
  INCOME: "INCOME",
  EXPENSE: "EXPENSE",
  TRANSFER: "TRANSFER",
};

export const ENVIRONMENT = {
  // App Config
  PORT: process.env.PORT || 3000,
  // DB Config
  DB_TYPE: process.env.DB_TYPE || DB_TYPES.SEQ,
  // Sequelize Config
  SEQ_PORT: process.env.SEQ_PORT || 3306,
  SEQ_HOST: process.env.SEQ_HOST,
  SEQ_DATABASE: process.env.SEQ_DATABASE,
  SEQ_USERNAME: process.env.SEQ_USERNAME,
  SEQ_PASSWORD: process.env.SEQ_PASSWORD,
  // Other Config
  // ...
};
