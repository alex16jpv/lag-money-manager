import { Request, Response } from "express";

import {
  SpendingGroupBy,
  SpendingQuery,
} from "../../domain/repositories/transaction/ITransactionRepository";
import { TransactionType } from "../../shared/constants";
import { DEFAULT_TIMEZONE } from "../../shared/timezone";
import repositoryFactory from "../factories/RepositoryFactory";
import { StatsService } from "../services/StatsService";

const statsService = new StatsService(
  repositoryFactory.getTransactionRepository(),
);
const userRepository = repositoryFactory.getUserRepository();

export class StatsController {
  static getSpending = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const user = await userRepository.getById(userId);
    const query: SpendingQuery = {
      groupBy: (req.query.groupBy as SpendingGroupBy) ?? "category",
      type: (req.query.type as TransactionType) ?? "EXPENSE",
      timezone: user?.timezone ?? DEFAULT_TIMEZONE,
    };
    if (req.query.from) query.from = new Date(req.query.from as string);
    if (req.query.to) query.to = new Date(req.query.to as string);

    const result = await statsService.getSpending(userId, query);
    res.status(200).json(result);
  };
}
