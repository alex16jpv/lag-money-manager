export interface IUserDataEraser {
  // The erasure of an account 30 days after it was deleted (decision 19): everything it holds and left behind. Idempotent.
  eraseAccount(userId: string): Promise<void>;
}
