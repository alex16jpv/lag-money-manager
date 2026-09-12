import { Request, Response } from "express";

import {
  SpendingGroupBy,
  SpendingQuery,
  SpendingSplitBy,
} from "../../domain/repositories/transaction/ITransactionRepository";
import { TransactionType } from "../../shared/constants";
import repositoryFactory from "../factories/RepositoryFactory";
import { StatsService } from "../services/StatsService";
import { splitIdList } from "../validation/schemas";
import { resolveTimezone } from "./timezone";

const statsService = new StatsService(
  repositoryFactory.getTransactionRepository(),
);

export class StatsController {
  static getSpending = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const timezone = await resolveTimezone(req);
    const query: SpendingQuery = {
      groupBy: (req.query.groupBy as SpendingGroupBy) ?? "category",
      type: (req.query.type as TransactionType) ?? "EXPENSE",
      timezone,
    };
    if (req.query.splitBy) {
      query.splitBy = req.query.splitBy as SpendingSplitBy;
    }
    if (req.query.categoryIds) {
      query.categoryIds = splitIdList(req.query.categoryIds as string);
    }
    if (req.query.from) query.from = new Date(req.query.from as string);
    if (req.query.to) query.to = new Date(req.query.to as string);

    const result = await statsService.getSpending(userId, query);
    res.status(200).json(result);
  };
}
