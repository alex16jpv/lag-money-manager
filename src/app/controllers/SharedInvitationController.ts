import { Request, Response } from "express";

import { extractPagination } from "../../shared/pagination";
import repositoryFactory from "../factories/RepositoryFactory";
import { SharedInvitationService } from "../services/SharedInvitationService";

const invitationService = new SharedInvitationService(
  repositoryFactory.getSharedInvitationRepository(),
  repositoryFactory.getSharedGroupRepository(),
  repositoryFactory.getContactRepository(),
  repositoryFactory.getUserRepository(),
);

export class SharedInvitationController {
  static invite = async (req: Request, res: Response) => {
    const outcome = { created: false };
    const invitation = await invitationService.invite(
      req.params.id as string,
      (req.body as { contactId: string }).contactId,
      req.user!.userId,
      outcome,
    );
    res.status(outcome.created ? 201 : 200).json(invitation);
  };

  static listForGroup = async (req: Request, res: Response) => {
    const result = await invitationService.listForGroup(
      req.params.id as string,
      req.user!.userId,
      extractPagination(req),
    );
    res.status(200).json(result);
  };

  static withdraw = async (req: Request, res: Response) => {
    const invitation = await invitationService.withdraw(
      req.params.id as string,
      req.params.invitationId as string,
      req.user!.userId,
    );
    res.status(200).json(invitation);
  };

  static listReceived = async (req: Request, res: Response) => {
    const result = await invitationService.listReceived(
      req.user!.userId,
      extractPagination(req),
    );
    res.status(200).json(result);
  };

  static accept = async (req: Request, res: Response) => {
    const invitation = await invitationService.accept(
      req.params.id as string,
      req.user!.userId,
    );
    res.status(200).json(invitation);
  };

  static leave = async (req: Request, res: Response) => {
    const invitation = await invitationService.leave(
      req.params.id as string,
      req.user!.userId,
    );
    res.status(200).json(invitation);
  };

  static decline = async (req: Request, res: Response) => {
    const invitation = await invitationService.decline(
      req.params.id as string,
      req.user!.userId,
    );
    res.status(200).json(invitation);
  };
}
