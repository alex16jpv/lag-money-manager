export interface IUserDataEraser {
  // Everything the account holds and left behind. Idempotent.
  eraseAccount(userId: string): Promise<void>;
}
