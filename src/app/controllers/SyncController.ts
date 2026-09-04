import { Request, Response } from "express";

import {
  ChangeCursor,
  decodeCursor,
  SYNC_DEFAULT_LIMIT,
} from "../../shared/syncCursor";
import repositoryFactory from "../factories/RepositoryFactory";
import { SyncService } from "../services/SyncService";

const syncService = new SyncService(
  repositoryFactory.getUserRepository(),
  repositoryFactory.getAccountRepository(),
  repositoryFactory.getCategoryRepository(),
  repositoryFactory.getTransactionRepository(),
  repositoryFactory.getBudgetRepository(),
);

/** No position at all is a full snapshot, which is the point of the endpoint. */
function position(req: Request): ChangeCursor | undefined {
  const cursor = req.query.cursor as string | undefined;
  if (cursor) return decodeCursor(cursor);
  const since = req.query.since as string | undefined;
  return since ? { updatedAt: new Date(since), id: null } : undefined;
}

export class SyncController {
  static getChanges = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const limit = Number(req.query.limit) || SYNC_DEFAULT_LIMIT;
    const result = await syncService.getChanges(userId, position(req), limit);
    res.status(200).json(result);
  };
}
