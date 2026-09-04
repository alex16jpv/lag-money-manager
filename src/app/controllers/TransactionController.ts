import { Request, Response } from "express";

import { TransactionFilters } from "../../domain/repositories/transaction/ITransactionRepository";
import { TransactionSource, TransactionType } from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import { extractPagination } from "../../shared/pagination";
import { hashPayload } from "../../shared/requestHash";
import repositoryFactory from "../factories/RepositoryFactory";
import {
  BatchDetailUpdate,
  IdempotencyMeta,
  TransactionService,
} from "../services/TransactionService";
import { ifMatch } from "./ifMatch";

// Bounded charset/length: the key becomes part of a stored _id.
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

function idempotencyMeta(req: Request): IdempotencyMeta | undefined {
  const key = req.get("Idempotency-Key");
  if (!key) return undefined;
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ApiError(
      "BadRequest",
      "Idempotency-Key must be 1-200 characters of [A-Za-z0-9_-]",
      "IDEMPOTENCY_KEY_INVALID",
    );
  }
  return { key, requestHash: hashPayload(req.body) };
}

const transactionService = new TransactionService(
  repositoryFactory.getTransactionRepository(),
  repositoryFactory.getAccountRepository(),
  repositoryFactory.getIdempotencyRepository(),
  repositoryFactory.getCategoryRepository(),
);

export class TransactionController {
  static getAllTransactions = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const filters: TransactionFilters = {};
    if (req.query.ids) {
      filters.ids = (req.query.ids as string).split(",").map((s) => s.trim());
    }
    if (req.query.accountId) {
      filters.accountId = req.query.accountId as string;
    }
    if (req.query.type) {
      filters.type = req.query.type as TransactionType;
    }
    if (req.query.pendingDetails !== undefined) {
      filters.pendingDetails = req.query.pendingDetails === "true";
    }
    if (req.query.source) {
      filters.source = req.query.source as TransactionSource;
    }
    if (req.query.categoryId) {
      filters.categoryId = req.query.categoryId as string;
    }
    if (req.query.includeSummary === "true") {
      filters.includeSummary = true;
    }
    if (req.query.uncategorized === "true") {
      filters.uncategorized = true;
    }
    if (req.query.from) {
      filters.from = new Date(req.query.from as string);
    }
    if (req.query.to) {
      filters.to = new Date(req.query.to as string);
    }
    if (req.query.tag) {
      filters.tag = req.query.tag as string;
    }
    const result = await transactionService.getAllTransactions(
      userId,
      extractPagination(req),
      filters,
    );
    res.status(200).json(result);
  };

  static getTags = async (req: Request, res: Response) => {
    const tags = await transactionService.getTags(req.user!.userId);
    res.status(200).json({ data: tags });
  };

  static batchUpdate = async (req: Request, res: Response) => {
    // The header is accepted because the client sends it on every mutation,
    // and validated so a malformed one is not silently ignored. Nothing is
    // stored against it: this sets fields to given values, so a retry lands on
    // the same state — it is idempotent by construction, not by bookkeeping.
    idempotencyMeta(req);
    const { items } = req.body as { items: BatchDetailUpdate[] };
    const result = await transactionService.batchUpdateDetails(
      items,
      req.user!.userId,
    );
    res.status(200).json(result);
  };

  static getTransactionById = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const transaction = await transactionService.getTransactionById(
      req.params.id as string,
      userId,
    );
    res.status(200).json(transaction);
  };

  static createTransaction = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const outcome = { replayed: false };
    const newTransaction = await transactionService.createTransaction(
      { ...req.body, userId },
      idempotencyMeta(req),
      outcome,
    );
    res.status(outcome.replayed ? 200 : 201).json(newTransaction);
  };

  static quickAddTransaction = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const outcome = { replayed: false };
    const newTransaction = await transactionService.quickAddTransaction(
      { ...req.body, userId },
      idempotencyMeta(req),
      outcome,
    );
    res.status(outcome.replayed ? 200 : 201).json(newTransaction);
  };

  static updateTransaction = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const id = req.params.id as string;
    const updatedTransaction = await transactionService.updateTransaction(
      id,
      req.body,
      userId,
      ifMatch(req),
    );
    res.status(200).json(updatedTransaction);
  };

  static deleteTransaction = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    await transactionService.deleteTransaction(
      req.params.id as string,
      userId,
      ifMatch(req),
    );
    res.status(200).json({ message: "Transaction deleted successfully" });
  };
}
