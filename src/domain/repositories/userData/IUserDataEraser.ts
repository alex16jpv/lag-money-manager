export interface IUserDataEraser {
  // Start fresh (decision 12): removes for good what the account holds, never the account. Idempotent.
  eraseAll(userId: string): Promise<void>;
  // It wasn't me (decision 11): also what the account itself left, its sessions and its address's codes.
  eraseAccount(userId: string, toHash: string): Promise<void>;
}
