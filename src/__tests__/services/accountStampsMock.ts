import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";

// The ledger reads account stamps only for what a movement's balance moved, which these suites never do.
export const noAccountStamps = (): jest.Mocked<IAccountRepository> =>
  ({
    stampsOf: jest.fn().mockResolvedValue(new Map()),
  }) as unknown as jest.Mocked<IAccountRepository>;
