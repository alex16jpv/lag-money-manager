import { Request, Response } from "express";

import { extractPagination } from "../../shared/pagination";
import repositoryFactory from "../factories/RepositoryFactory";
import { sharedLedgerService } from "../factories/sharedLedger";
import {
  AddToLedgerDTO,
  JoinedGroupService,
} from "../services/JoinedGroupService";
import { TransactionService } from "../services/TransactionService";
import { resolveTimezone } from "./timezone";

const joinedGroupService = new JoinedGroupService(
  repositoryFactory.getSharedInvitationRepository(),
  repositoryFactory.getSharedGroupRepository(),
  repositoryFactory.getSharedExpenseRepository(),
  repositoryFactory.getContactRepository(),
  repositoryFactory.getUserRepository(),
  repositoryFactory.getTransactionRepository(),
  new TransactionService(
    repositoryFactory.getTransactionRepository(),
    repositoryFactory.getAccountRepository(),
    repositoryFactory.getIdempotencyRepository(),
    repositoryFactory.getCategoryRepository(),
    sharedLedgerService,
  ),
);

export class JoinedGroupController {
  static list = async (req: Request, res: Response): Promise<void> => {
    const result = await joinedGroupService.list(
      req.user!.userId,
      extractPagination(req),
    );
    res.status(200).json(result);
  };

  static get = async (req: Request, res: Response): Promise<void> => {
    const group = await joinedGroupService.get(
      req.params.id as string,
      req.user!.userId,
    );
    res.status(200).json(group);
  };

  static listExpenses = async (req: Request, res: Response): Promise<void> => {
    const result = await joinedGroupService.listExpenses(
      req.params.id as string,
      req.user!.userId,
      extractPagination(req),
    );
    res.status(200).json(result);
  };

  static addToLedger = async (req: Request, res: Response): Promise<void> => {
    const outcome = { replayed: false };
    const transaction = await joinedGroupService.addToLedger(
      req.params.id as string,
      req.params.expenseId as string,
      req.body as AddToLedgerDTO,
      req.user!.userId,
      await resolveTimezone(req),
      outcome,
    );
    res.status(outcome.replayed ? 200 : 201).json(transaction);
  };
}
