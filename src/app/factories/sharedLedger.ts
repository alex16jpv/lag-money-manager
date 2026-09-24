import { SharedLedgerService } from "../services/SharedLedgerService";
import repositoryFactory from "./RepositoryFactory";

// One instance for every controller that writes something the imputation depends on.
export const sharedLedgerService = new SharedLedgerService(
  repositoryFactory.getSharedExpenseRepository(),
  repositoryFactory.getSharedSettlementRepository(),
  repositoryFactory.getTransactionRepository(),
  repositoryFactory.getAccountRepository(),
);
