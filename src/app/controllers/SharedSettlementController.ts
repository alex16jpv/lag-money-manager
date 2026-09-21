import { Request, Response } from "express";

import { SettlementFilters } from "../../domain/repositories/sharedSettlement/ISharedSettlementRepository";
import { extractPagination } from "../../shared/pagination";
import repositoryFactory from "../factories/RepositoryFactory";
import { sharedLedgerService } from "../factories/sharedLedger";
import { SharedSettlementService } from "../services/SharedSettlementService";
import { TransactionService } from "../services/TransactionService";
import { ifMatch } from "./ifMatch";
import { resolveTimezone } from "./timezone";

const settlementService = new SharedSettlementService(
  repositoryFactory.getSharedSettlementRepository(),
  repositoryFactory.getSharedExpenseRepository(),
  repositoryFactory.getContactRepository(),
  repositoryFactory.getUserRepository(),
  sharedLedgerService,
  new TransactionService(
    repositoryFactory.getTransactionRepository(),
    repositoryFactory.getAccountRepository(),
    repositoryFactory.getIdempotencyRepository(),
    repositoryFactory.getCategoryRepository(),
    sharedLedgerService,
  ),
);

export class SharedSettlementController {
  static getSettlements = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const userId = req.user!.userId;
    const filters: SettlementFilters = {};
    if (req.query.contactId) {
      filters.contactId = req.query.contactId as string;
    }
    if (req.query.expenseId) {
      filters.expenseId = req.query.expenseId as string;
    }
    const result = await settlementService.getSettlements(
      userId,
      extractPagination(req),
      filters,
    );
    res.status(200).json(result);
  };

  static getSettlementById = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const userId = req.user!.userId;
    const settlement = await settlementService.getSettlementById(
      req.params.id as string,
      userId,
    );
    res.status(200).json(settlement);
  };

  static createSettlement = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const userId = req.user!.userId;
    const outcome = { replayed: false };
    const result = await settlementService.createSettlement(
      { ...req.body, userId },
      await resolveTimezone(req),
      outcome,
    );
    res.status(outcome.replayed ? 200 : 201).json(result);
  };

  static deleteSettlement = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const userId = req.user!.userId;
    const deleted = await settlementService.deleteSettlement(
      req.params.id as string,
      userId,
      ifMatch(req),
    );
    res.status(200).json(deleted);
  };
}
