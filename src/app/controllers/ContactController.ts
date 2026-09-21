import { Request, Response } from "express";

import { ContactFilters } from "../../domain/repositories/contact/IContactRepository";
import { extractPagination } from "../../shared/pagination";
import repositoryFactory from "../factories/RepositoryFactory";
import { ContactService } from "../services/ContactService";
import { splitIdList } from "../validation/schemas";
import { ifMatch } from "./ifMatch";

const contactService = new ContactService(
  repositoryFactory.getContactRepository(),
);

export class ContactController {
  static getAllContacts = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const filters: ContactFilters = {};
    if (req.query.ids) {
      filters.ids = splitIdList(req.query.ids as string);
    }
    if (req.query.includeArchived === "true") {
      filters.includeArchived = true;
    }

    const result = await contactService.getAllContacts(
      userId,
      extractPagination(req),
      filters,
    );
    res.status(200).json(result);
  };

  static getContactById = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const contact = await contactService.getContactById(
      req.params.id as string,
      userId,
    );
    res.status(200).json(contact);
  };

  static createContact = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const outcome = { replayed: false };
    const created = await contactService.createContact(
      { ...req.body, userId },
      outcome,
    );
    res.status(outcome.replayed ? 200 : 201).json(created);
  };

  static updateContact = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const updated = await contactService.updateContact(
      req.params.id as string,
      req.body,
      userId,
      ifMatch(req),
    );
    res.status(200).json(updated);
  };

  static deleteContact = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const archived = await contactService.deleteContact(
      req.params.id as string,
      userId,
      ifMatch(req),
    );
    res.status(200).json(archived);
  };

  static restoreContact = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const contact = await contactService.restoreContact(
      req.params.id as string,
      userId,
      (req.body as { name?: string } | undefined)?.name,
      ifMatch(req),
    );
    res.status(200).json(contact);
  };
}
