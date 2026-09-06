import { z } from "zod";

import { ISyncOpRepository } from "../../domain/repositories/syncOp/ISyncOpRepository";
import { ErrorCode } from "../../shared/errorCodes";
import { describeFailure } from "../../shared/errorResponse";
import {
  SYNC_ACTIONS,
  SYNC_LANDED_STATUSES,
  SYNC_SUPPORTED_OP_VERSIONS,
  SyncEntity,
  SyncOpStatus,
} from "../../shared/syncBatch";
import * as v from "../validation/schemas";
import { SyncOperationInput } from "../validation/schemas";
import { AccountService } from "./AccountService";
import { BudgetService } from "./BudgetService";
import { CategoryService } from "./CategoryService";
import { TransactionService } from "./TransactionService";

export interface SyncOpResult {
  opId: string;
  seq: number;
  entity: SyncEntity;
  id: string;
  status: SyncOpStatus;
  code?: ErrorCode;
  message?: string;
  details?: unknown;
  // STALE_UPDATE: the row as the server has it, same as the HTTP 409.
  current?: unknown;
  // applied/duplicate: what the matching route would have answered.
  result?: unknown;
  // blocked: the opId of the operation in this batch that failed first.
  blockedBy?: string;
}

export interface SyncBatchResult {
  serverTime: Date;
  results: SyncOpResult[];
}

interface Context {
  userId: string;
  timezone: string;
}

type Outcome = Omit<SyncOpResult, "opId" | "seq" | "entity" | "id">;

/** A body the route would have parsed; the create's id is the envelope's. */
type Body = Record<string, unknown>;

const bodyOf = (schema: z.ZodObject): z.ZodType =>
  (schema.shape as { body: z.ZodType }).body;

interface Handler {
  // Undefined: the route takes no body and any sent is ignored, like HTTP.
  body?: z.ZodType;
  // Creates set the body's id from the envelope and read the replay flag.
  create?: boolean;
  run: (
    op: SyncOperationInput,
    body: Body,
    ctx: Context,
    guard: Date | undefined,
    outcome: { replayed: boolean },
  ) => Promise<unknown>;
}

function rejected(field: string, message: string): Outcome {
  return {
    status: "rejected",
    code: "VALIDATION",
    message: "Invalid request data",
    details: [{ field, message }],
  };
}

/**
 * `POST /sync`: the offline queue, applied in order through the SAME services
 * the HTTP routes call (trap 7.8 — no business rule lives here). Each
 * operation is answered on its own; the batch has no transaction and a
 * failure never stops the queue, only what depends on it.
 */
export class SyncBatchService {
  private readonly handlers: Record<string, Handler>;

  constructor(
    private accounts: AccountService,
    private categories: CategoryService,
    private transactions: TransactionService,
    private budgets: BudgetService,
    private syncOps: ISyncOpRepository,
  ) {
    const budgetCtx = (
      op: SyncOperationInput,
      ctx: Context,
    ): { reference: Date; timezone: string } => ({
      reference: op.payload.query?.reference
        ? new Date(op.payload.query.reference)
        : new Date(),
      timezone: ctx.timezone,
    });
    this.handlers = {
      "account:create": {
        body: bodyOf(v.createAccountSchema),
        create: true,
        run: (_op, body, ctx, _guard, outcome) =>
          this.accounts.createAccount(
            { ...body, userId: ctx.userId } as never,
            outcome,
          ),
      },
      "account:update": {
        body: bodyOf(v.updateAccountSchema),
        run: (op, body, ctx, guard) =>
          this.accounts.updateAccount(op.id, body as never, ctx.userId, guard),
      },
      "account:archive": {
        run: (op, _body, ctx, guard) =>
          this.accounts.deleteAccount(op.id, ctx.userId, guard),
      },
      "account:restore": {
        body: bodyOf(v.restoreSchema),
        run: (op, body, ctx, guard) =>
          this.accounts.restoreAccount(
            op.id,
            ctx.userId,
            (body as { name?: string }).name,
            guard,
          ),
      },
      "account:setDefault": {
        run: (op, _body, ctx, guard) =>
          this.accounts.setDefaultAccount(op.id, ctx.userId, guard),
      },
      "category:create": {
        body: bodyOf(v.createCategorySchema),
        create: true,
        run: (_op, body, ctx, _guard, outcome) =>
          this.categories.createCategory(
            { ...body, userId: ctx.userId } as never,
            outcome,
          ),
      },
      "category:update": {
        body: bodyOf(v.updateCategorySchema),
        run: (op, body, ctx, guard) =>
          this.categories.updateCategory(
            op.id,
            body as never,
            ctx.userId,
            guard,
          ),
      },
      "category:archive": {
        run: (op, _body, ctx, guard) =>
          this.categories.deleteCategory(op.id, ctx.userId, guard),
      },
      "category:restore": {
        body: bodyOf(v.restoreSchema),
        run: (op, body, ctx, guard) =>
          this.categories.restoreCategory(
            op.id,
            ctx.userId,
            (body as { name?: string }).name,
            guard,
          ),
      },
      "transaction:create": {
        body: bodyOf(v.createTransactionSchema),
        create: true,
        // No Idempotency-Key: the client-minted id already makes it a replay.
        run: (_op, body, ctx, _guard, outcome) =>
          this.transactions.createTransaction(
            { ...body, userId: ctx.userId } as never,
            undefined,
            outcome,
          ),
      },
      "transaction:quickAdd": {
        body: bodyOf(v.quickAddTransactionSchema),
        create: true,
        run: (_op, body, ctx, _guard, outcome) =>
          this.transactions.quickAddTransaction(
            { ...body, userId: ctx.userId } as never,
            undefined,
            outcome,
          ),
      },
      "transaction:update": {
        body: bodyOf(v.updateTransactionSchema),
        run: (op, body, ctx, guard) =>
          this.transactions.updateTransaction(
            op.id,
            body as never,
            ctx.userId,
            guard,
          ),
      },
      "transaction:delete": {
        run: (op, _body, ctx, guard) =>
          this.transactions.deleteTransaction(op.id, ctx.userId, guard),
      },
      "budget:create": {
        body: bodyOf(v.createBudgetSchema),
        create: true,
        run: (op, body, ctx, _guard, outcome) =>
          this.budgets.createBudget(
            { ...body, userId: ctx.userId } as never,
            budgetCtx(op, ctx),
            outcome,
          ),
      },
      "budget:update": {
        body: bodyOf(v.updateBudgetSchema),
        run: (op, body, ctx, guard) =>
          this.budgets.updateBudget(
            op.id,
            body as never,
            ctx.userId,
            budgetCtx(op, ctx),
            guard,
          ),
      },
      "budget:archive": {
        run: (op, _body, ctx, guard) =>
          this.budgets.deleteBudget(
            op.id,
            ctx.userId,
            budgetCtx(op, ctx),
            guard,
          ),
      },
      "budget:restore": {
        run: (op, _body, ctx, guard) =>
          this.budgets.restoreBudget(
            op.id,
            ctx.userId,
            budgetCtx(op, ctx),
            guard,
          ),
      },
      "budget:setOverride": {
        body: bodyOf(v.budgetAmountOverrideSchema),
        run: (op, body, ctx, guard) =>
          this.budgets.setAmountOverride(
            op.id,
            ctx.userId,
            (body as { amount: number }).amount,
            budgetCtx(op, ctx),
            guard,
          ),
      },
      "budget:clearOverride": {
        run: (op, _body, ctx, guard) =>
          this.budgets.clearAmountOverride(
            op.id,
            ctx.userId,
            budgetCtx(op, ctx),
            guard,
          ),
      },
    };
  }

  async apply(
    ctx: Context,
    operations: SyncOperationInput[],
  ): Promise<SyncBatchResult> {
    const serverTime = new Date();
    // `seq` is the device's order, whatever order the array arrived in.
    const ordered = [...operations].sort((a, b) => a.seq - b.seq);
    // Entity id → opId of the operation in this batch that failed on it.
    const failed = new Map<string, string>();
    const results: SyncOpResult[] = [];

    for (const op of ordered) {
      const outcome = await this.applyOne(ctx, op, failed);
      if (!SYNC_LANDED_STATUSES.includes(outcome.status)) {
        failed.set(op.id, op.opId);
      }
      results.push({
        opId: op.opId,
        seq: op.seq,
        entity: op.entity,
        id: op.id,
        ...outcome,
      });
    }

    return { serverTime, results };
  }

  private async applyOne(
    ctx: Context,
    op: SyncOperationInput,
    failed: Map<string, string>,
  ): Promise<Outcome> {
    // The row itself counts as a dependency: a second write on a row whose
    // first write did not land would only repeat the same failure.
    const blockedBy = [op.id, ...op.dependsOn]
      .map((id) => failed.get(id))
      .find((opId) => opId !== undefined);
    if (blockedBy) {
      return { status: "blocked", blockedBy };
    }

    const seen = await this.syncOps.find(ctx.userId, op.opId);
    if (seen) {
      return {
        status: "duplicate",
        ...(seen.code && { code: seen.code as ErrorCode }),
      };
    }

    const outcome = await this.execute(ctx, op);
    if (SYNC_LANDED_STATUSES.includes(outcome.status)) {
      await this.syncOps.record(ctx.userId, op.opId, {
        status: outcome.status,
        entityId: op.id,
        code: outcome.code ?? null,
      });
    }
    return outcome;
  }

  private async execute(
    ctx: Context,
    op: SyncOperationInput,
  ): Promise<Outcome> {
    if (!SYNC_SUPPORTED_OP_VERSIONS.includes(op.opVersion)) {
      return rejected(
        "opVersion",
        `Unsupported operation version ${op.opVersion}; this server accepts ${SYNC_SUPPORTED_OP_VERSIONS.join(", ")}`,
      );
    }
    const handler = this.handlers[`${op.entity}:${op.action}`];
    if (!handler) {
      return rejected(
        "action",
        `Unknown action "${op.action}" for ${op.entity}. Available: ${SYNC_ACTIONS[op.entity].join(", ")}`,
      );
    }

    let body: Body = {};
    if (handler.body) {
      const raw = op.payload.body ?? {};
      if (handler.create && raw.id !== undefined && raw.id !== op.id) {
        return rejected(
          "payload.body.id",
          "payload.body.id must equal the operation's id",
        );
      }
      const parsed = handler.body.safeParse(
        handler.create ? { ...raw, id: op.id } : raw,
      );
      if (!parsed.success) {
        return {
          status: "rejected",
          code: "VALIDATION",
          message: "Invalid request data",
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        };
      }
      body = parsed.data as Body;
    }

    const guard = op.baseUpdatedAt ? new Date(op.baseUpdatedAt) : undefined;
    const outcome = { replayed: false };
    try {
      const result = await handler.run(op, body, ctx, guard, outcome);
      return {
        status: outcome.replayed ? "duplicate" : "applied",
        ...(result !== undefined && { result }),
      };
    } catch (err) {
      const failure = describeFailure(err as Error);
      // Not the client's fault (database down, a bug): the whole request
      // fails, loudly. What already landed is on record and replays as
      // `duplicate` when the batch is sent again.
      if (!failure) throw err;
      const { body: b } = failure;
      return {
        status: failure.status === 409 ? "conflict" : "rejected",
        // Same default as PATCH /transactions/batch: without an HTTP status
        // per operation, a code-less 404 would leave the client nothing to
        // branch on.
        code: b.code ?? (failure.status === 404 ? "NOT_FOUND" : "BAD_REQUEST"),
        message: b.message,
        ...(b.details !== undefined && { details: b.details }),
        ...(b.current !== undefined && { current: b.current }),
      };
    }
  }
}
