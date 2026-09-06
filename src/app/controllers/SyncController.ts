import { Request, Response } from "express";

import {
  ChangeCursor,
  decodeCursor,
  SYNC_DEFAULT_LIMIT,
} from "../../shared/syncCursor";
import { DEFAULT_TIMEZONE } from "../../shared/timezone";
import repositoryFactory from "../factories/RepositoryFactory";
import { AuthPayload } from "../middlewares/authMiddleware";
import { AccountService } from "../services/AccountService";
import { BudgetService } from "../services/BudgetService";
import { CategoryService } from "../services/CategoryService";
import { SyncBatchService } from "../services/SyncBatchService";
import { SyncService } from "../services/SyncService";
import { TransactionService } from "../services/TransactionService";
import { SyncOperationInput } from "../validation/schemas";

const userRepository = repositoryFactory.getUserRepository();
const accountRepository = repositoryFactory.getAccountRepository();
const categoryRepository = repositoryFactory.getCategoryRepository();
const transactionRepository = repositoryFactory.getTransactionRepository();
const budgetRepository = repositoryFactory.getBudgetRepository();

const syncService = new SyncService(
  userRepository,
  accountRepository,
  categoryRepository,
  transactionRepository,
  budgetRepository,
);

// The very same service instances' wiring the HTTP controllers use: the
// batch must answer exactly what the routes would (trap 7.8).
const syncBatchService = new SyncBatchService(
  new AccountService(accountRepository, userRepository),
  new CategoryService(categoryRepository, transactionRepository),
  new TransactionService(
    transactionRepository,
    accountRepository,
    repositoryFactory.getIdempotencyRepository(),
    categoryRepository,
  ),
  new BudgetService(
    budgetRepository,
    transactionRepository,
    categoryRepository,
    userRepository,
  ),
  repositoryFactory.getSyncOpRepository(),
);

/** No position at all is a full snapshot, which is the point of the endpoint. */
function position(req: Request): ChangeCursor | undefined {
  const cursor = req.query.cursor as string | undefined;
  if (cursor) return decodeCursor(cursor);
  const since = req.query.since as string | undefined;
  return since ? { updatedAt: new Date(since), id: null } : undefined;
}

// Behind authMiddleware the principal is always set.
const principal = (req: Request): AuthPayload => req.user as AuthPayload;

// Same resolution as the budget routes: token claim first, DB fallback for
// tokens minted before the claim existed.
async function timezoneOf(req: Request): Promise<string> {
  const { userId, timezone } = principal(req);
  return (
    timezone ??
    (await userRepository.getById(userId))?.timezone ??
    DEFAULT_TIMEZONE
  );
}

export class SyncController {
  static getChanges = async (req: Request, res: Response): Promise<void> => {
    const { userId } = principal(req);
    const limit = Number(req.query.limit) || SYNC_DEFAULT_LIMIT;
    const result = await syncService.getChanges(userId, position(req), limit);
    res.status(200).json(result);
  };

  static push = async (req: Request, res: Response): Promise<void> => {
    const { operations } = req.body as { operations: SyncOperationInput[] };
    const result = await syncBatchService.apply(
      { userId: principal(req).userId, timezone: await timezoneOf(req) },
      operations,
    );
    res.status(200).json(result);
  };
}
