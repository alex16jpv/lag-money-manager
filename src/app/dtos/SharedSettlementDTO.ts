export interface SettlementLineCategoryDTO {
  expenseId: string;
  categoryId: string;
}

export interface CreateSharedSettlementDTO {
  id?: string;
  userId: string;
  // One of the two: a person, or the block of guests of that expense.
  contactId?: string;
  expenseId?: string;
  date: Date;
  // What came back to you, what you handed over. One settle-up can write both halves.
  collected?: number;
  paid?: number;
  // Cash the app never saw: nothing is recorded in an account, and what is owed falls all the same.
  outsideApp?: boolean;
  // Where the money lands or leaves; not stored on the payment, which everybody in the group sees.
  accountId?: string;
  // Only for what you pay back: the shared layer carries no categories, so the user picks one.
  categoryId?: string;
  categories?: SettlementLineCategoryDTO[];
}
