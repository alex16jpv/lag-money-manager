import { ISharedCounterpartyRepository } from "../../domain/repositories/sharedCounterparty/ISharedCounterpartyRepository";

// The claim only matters between two real transactions, which the mongod suite exercises.
export const counterpartyClaims =
  (): jest.Mocked<ISharedCounterpartyRepository> => ({
    claim: jest.fn().mockResolvedValue(undefined),
  });
