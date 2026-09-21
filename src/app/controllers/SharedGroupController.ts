import { Request, Response } from "express";

import { SharedGroupFilters } from "../../domain/repositories/sharedGroup/ISharedGroupRepository";
import { extractPagination } from "../../shared/pagination";
import repositoryFactory from "../factories/RepositoryFactory";
import { sharedLedgerService } from "../factories/sharedLedger";
import { SharedGroupService } from "../services/SharedGroupService";
import { splitIdList } from "../validation/schemas";
import { ifMatch } from "./ifMatch";

const sharedGroupService = new SharedGroupService(
  repositoryFactory.getSharedGroupRepository(),
  repositoryFactory.getSharedExpenseRepository(),
  repositoryFactory.getContactRepository(),
  repositoryFactory.getUserRepository(),
  repositoryFactory.getTransactionRepository(),
  sharedLedgerService,
);

export class SharedGroupController {
  static getAllGroups = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const filters: SharedGroupFilters = {};
    if (req.query.ids) {
      filters.ids = splitIdList(req.query.ids as string);
    }
    if (req.query.includeArchived === "true") {
      filters.includeArchived = true;
    }
    if (req.query.contactId) {
      filters.contactId = req.query.contactId as string;
    }
    const result = await sharedGroupService.getAllGroups(
      userId,
      extractPagination(req),
      filters,
    );
    res.status(200).json(result);
  };

  static getGroupById = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const group = await sharedGroupService.getGroupById(
      req.params.id as string,
      userId,
    );
    res.status(200).json(group);
  };

  static createGroup = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const outcome = { replayed: false };
    const created = await sharedGroupService.createGroup(
      { ...req.body, userId },
      outcome,
    );
    res.status(outcome.replayed ? 200 : 201).json(created);
  };

  static updateGroup = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const updated = await sharedGroupService.updateGroup(
      req.params.id as string,
      req.body,
      userId,
      ifMatch(req),
    );
    res.status(200).json(updated);
  };

  static deleteGroup = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const archived = await sharedGroupService.deleteGroup(
      req.params.id as string,
      userId,
      ifMatch(req),
    );
    res.status(200).json(archived);
  };

  static restoreGroup = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const group = await sharedGroupService.restoreGroup(
      req.params.id as string,
      userId,
      (req.body as { name?: string } | undefined)?.name,
      ifMatch(req),
    );
    res.status(200).json(group);
  };

  static previewParticipants = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const preview = await sharedGroupService.previewParticipants(
      req.params.id as string,
      req.body,
      userId,
    );
    res.status(200).json(preview);
  };

  static addParticipants = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const result = await sharedGroupService.addParticipants(
      req.params.id as string,
      req.body,
      userId,
      ifMatch(req),
    );
    res.status(200).json(result);
  };

  static removeParticipant = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const group = await sharedGroupService.removeParticipant(
      req.params.id as string,
      req.params.contactId as string,
      userId,
      ifMatch(req),
    );
    res.status(200).json(group);
  };

  static writeOff = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const group = await sharedGroupService.writeOff(
      req.params.id as string,
      req.body,
      userId,
      ifMatch(req),
    );
    res.status(200).json(group);
  };

  static undoWriteOff = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const group = await sharedGroupService.undoWriteOff(
      req.params.id as string,
      req.params.partyId as string,
      userId,
      ifMatch(req),
    );
    res.status(200).json(group);
  };
}
