import { Request, Response } from "express";

import { BudgetFilters } from "../../domain/repositories/budget/IBudgetRepository";
import { extractPagination } from "../../shared/pagination";
import { DEFAULT_TIMEZONE } from "../../shared/timezone";
import repositoryFactory from "../factories/RepositoryFactory";
import { BudgetService } from "../services/BudgetService";

const budgetService = new BudgetService(
  repositoryFactory.getBudgetRepository(),
  repositoryFactory.getTransactionRepository(),
  repositoryFactory.getCategoryRepository(),
  repositoryFactory.getUserRepository(),
);
const userRepository = repositoryFactory.getUserRepository();

async function resolveContext(req: Request) {
  // Token claim first (R2-23); DB fallback covers tokens minted before it.
  const timezone =
    req.user!.timezone ??
    (await userRepository.getById(req.user!.userId))?.timezone ??
    DEFAULT_TIMEZONE;
  const reference = req.query.reference
    ? new Date(req.query.reference as string)
    : new Date();
  return { reference, timezone };
}

export class BudgetController {
  static getAllBudgets = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const filters: BudgetFilters = {};
    if (req.query.includeArchived === "true") {
      filters.includeArchived = true;
    }
    if (req.query.includeExpired === "true") {
      filters.includeExpired = true;
    }
    const result = await budgetService.getBudgets(
      userId,
      extractPagination(req),
      filters,
      await resolveContext(req),
    );
    res.status(200).json(result);
  };

  static getBudgetById = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const budget = await budgetService.getBudgetById(
      req.params.id as string,
      userId,
      await resolveContext(req),
    );
    res.status(200).json(budget);
  };

  static createBudget = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const outcome = { replayed: false };
    const budget = await budgetService.createBudget(
      { ...req.body, userId },
      await resolveContext(req),
      outcome,
    );
    res.status(outcome.replayed ? 200 : 201).json(budget);
  };

  static updateBudget = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const budget = await budgetService.updateBudget(
      req.params.id as string,
      req.body,
      userId,
      await resolveContext(req),
    );
    res.status(200).json(budget);
  };

  static deleteBudget = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    await budgetService.deleteBudget(req.params.id as string, userId);
    res.status(200).json({ message: "Budget archived successfully" });
  };

  static restoreBudget = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const budget = await budgetService.restoreBudget(
      req.params.id as string,
      userId,
      await resolveContext(req),
    );
    res.status(200).json(budget);
  };

  static clearAmountOverride = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const budget = await budgetService.clearAmountOverride(
      req.params.id as string,
      userId,
      await resolveContext(req),
    );
    res.status(200).json(budget);
  };

  static setAmountOverride = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const budget = await budgetService.setAmountOverride(
      req.params.id as string,
      userId,
      req.body.amount,
      await resolveContext(req),
    );
    res.status(200).json(budget);
  };
}
