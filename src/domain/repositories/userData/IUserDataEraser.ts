export interface IUserDataEraser {
  // Start fresh (decision 12): removes for good what the account holds, never the account. Idempotent.
  eraseAll(userId: string): Promise<void>;
}
