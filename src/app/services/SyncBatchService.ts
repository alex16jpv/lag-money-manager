import { z } from "zod";

import { Account } from "../../domain/entities/Account";
import { Category } from "../../domain/entities/Category";
import { ISyncOpRepository } from "../../domain/repositories/syncOp/ISyncOpRepository";
import { ErrorCode } from "../../shared/errorCodes";
import { describeFailure } from "../../shared/errorResponse";
import {
  SYNC_ACTIONS,
  SYNC_LANDED_STATUSES,
  SYNC_SUPPORTED_OP_VERSIONS,
  SyncEntity,
  SyncOpStatus,
  SyncWarning,
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
  // STALE_UPDATE, and the conflicts a row explains: the row as the server
  // has it, same as the HTTP 409.
  current?: unknown;
  // applied/merged/duplicate: what the matching route would have answered.
  result?: unknown;
  // blocked: the opId of the operation in this batch that failed first.
  blockedBy?: string;
  // merged: the server row this operation landed on instead of `id`.
  mergedInto?: string;
  // The write landed, but not as it was sent (an archived reference dropped).
  warnings?: SyncWarning[];
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

interface RunArgs {
  op: SyncOperationInput;
  // The row the operation writes: `op.id`, or the server row a merge earlier
  // in this batch redirected it to.
  id: string;
  body: Body;
  ctx: Context;
  guard: Date | undefined;
  outcome: { replayed: boolean };
}

interface Handler {
  // Undefined: the route takes no body and any sent is ignored, like HTTP.
  body?: z.ZodType;
  // Creates set the body's id from the envelope and read the replay flag.
  create?: boolean;
  // Whose active name a DUPLICATE is about (§5.1). The row that holds the
  // name rides back as `current` on every write that names one; only a
  // category's CREATE merges into it (same type). An account's never merges —
  // that would rewrite balances — and no update or restore does either.
  nameOwner?: "category" | "account";
  // Body fields naming a category, redirected when the batch merged it.
  categoryFields?: readonly string[];
  // A category archived online is dropped instead of refusing the write
  // (§5.3). Transactions only: a budget without categories is a GLOBAL
  // budget, so dropping one would silently change what it counts.
  dropsCategory?: boolean;
  // Body fields naming an account: one archived online explains a bare 404.
  accountFields?: readonly string[];
  // The route removes the row: a 404 may mean the row is already gone, which
  // is the state the operation wanted (§5.4).
  removesRow?: boolean;
  run: (args: RunArgs) => Promise<unknown>;
}

const ACCOUNT_SIDES = ["fromAccountId", "toAccountId"] as const;

function rejected(field: string, message: string): Outcome {
  return {
    status: "rejected",
    code: "VALIDATION",
    message: "Invalid request data",
    details: [{ field, message }],
  };
}

/** Redirects, inside a body, the ids a merge in this batch replaced. */
function redirect(
  body: Body,
  fields: readonly string[] | undefined,
  merged: Map<string, string>,
): Body {
  if (!fields || merged.size === 0) return body;
  const swap = (id: unknown): unknown =>
    typeof id === "string" ? (merged.get(id) ?? id) : id;
  const next = { ...body };
  for (const field of fields) {
    const value = next[field];
    next[field] = Array.isArray(value) ? value.map(swap) : swap(value);
  }
  return next;
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
        nameOwner: "account",
        run: ({ body, ctx, outcome }) =>
          this.accounts.createAccount(
            { ...body, userId: ctx.userId } as never,
            outcome,
          ),
      },
      "account:update": {
        body: bodyOf(v.updateAccountSchema),
        nameOwner: "account",
        run: ({ id, body, ctx, guard }) =>
          this.accounts.updateAccount(id, body as never, ctx.userId, guard),
      },
      "account:archive": {
        run: ({ id, ctx, guard }) =>
          this.accounts.deleteAccount(id, ctx.userId, guard),
      },
      "account:restore": {
        body: bodyOf(v.restoreSchema),
        nameOwner: "account",
        run: ({ id, body, ctx, guard }) =>
          this.accounts.restoreAccount(
            id,
            ctx.userId,
            (body as { name?: string }).name,
            guard,
          ),
      },
      "account:setDefault": {
        run: ({ id, ctx, guard }) =>
          this.accounts.setDefaultAccount(id, ctx.userId, guard),
      },
      "category:create": {
        body: bodyOf(v.createCategorySchema),
        create: true,
        nameOwner: "category",
        run: ({ body, ctx, outcome }) =>
          this.categories.createCategory(
            { ...body, userId: ctx.userId } as never,
            outcome,
          ),
      },
      "category:update": {
        body: bodyOf(v.updateCategorySchema),
        nameOwner: "category",
        run: ({ id, body, ctx, guard }) =>
          this.categories.updateCategory(id, body as never, ctx.userId, guard),
      },
      "category:archive": {
        run: ({ id, ctx, guard }) =>
          this.categories.deleteCategory(id, ctx.userId, guard),
      },
      "category:restore": {
        body: bodyOf(v.restoreSchema),
        nameOwner: "category",
        run: ({ id, body, ctx, guard }) =>
          this.categories.restoreCategory(
            id,
            ctx.userId,
            (body as { name?: string }).name,
            guard,
          ),
      },
      "transaction:create": {
        body: bodyOf(v.createTransactionSchema),
        create: true,
        categoryFields: ["categoryId"],
        dropsCategory: true,
        accountFields: ACCOUNT_SIDES,
        // No Idempotency-Key: the client-minted id already makes it a replay.
        run: ({ body, ctx, outcome }) =>
          this.transactions.createTransaction(
            { ...body, userId: ctx.userId } as never,
            undefined,
            outcome,
          ),
      },
      "transaction:quickAdd": {
        body: bodyOf(v.quickAddTransactionSchema),
        create: true,
        categoryFields: ["categoryId"],
        dropsCategory: true,
        accountFields: ACCOUNT_SIDES,
        run: ({ body, ctx, outcome }) =>
          this.transactions.quickAddTransaction(
            { ...body, userId: ctx.userId } as never,
            undefined,
            outcome,
          ),
      },
      "transaction:update": {
        body: bodyOf(v.updateTransactionSchema),
        categoryFields: ["categoryId"],
        dropsCategory: true,
        accountFields: ACCOUNT_SIDES,
        run: ({ id, body, ctx, guard }) =>
          this.transactions.updateTransaction(
            id,
            body as never,
            ctx.userId,
            guard,
          ),
      },
      "transaction:delete": {
        removesRow: true,
        run: ({ id, ctx, guard }) =>
          this.transactions.deleteTransaction(id, ctx.userId, guard),
      },
      "budget:create": {
        body: bodyOf(v.createBudgetSchema),
        create: true,
        categoryFields: ["categoryIds"],
        run: ({ op, body, ctx, outcome }) =>
          this.budgets.createBudget(
            { ...body, userId: ctx.userId } as never,
            budgetCtx(op, ctx),
            outcome,
          ),
      },
      "budget:update": {
        body: bodyOf(v.updateBudgetSchema),
        categoryFields: ["categoryIds"],
        run: ({ op, id, body, ctx, guard }) =>
          this.budgets.updateBudget(
            id,
            body as never,
            ctx.userId,
            budgetCtx(op, ctx),
            guard,
          ),
      },
      "budget:archive": {
        run: ({ op, id, ctx, guard }) =>
          this.budgets.deleteBudget(id, ctx.userId, budgetCtx(op, ctx), guard),
      },
      "budget:restore": {
        run: ({ op, id, ctx, guard }) =>
          this.budgets.restoreBudget(id, ctx.userId, budgetCtx(op, ctx), guard),
      },
      "budget:setOverride": {
        body: bodyOf(v.budgetAmountOverrideSchema),
        run: ({ op, id, body, ctx, guard }) =>
          this.budgets.setAmountOverride(
            id,
            ctx.userId,
            (body as { amount: number }).amount,
            budgetCtx(op, ctx),
            guard,
          ),
      },
      "budget:clearOverride": {
        run: ({ op, id, ctx, guard }) =>
          this.budgets.clearAmountOverride(
            id,
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
    // Id the device minted → the server row a merge landed it on (§5.1).
    const merged = new Map<string, string>();
    const results: SyncOpResult[] = [];

    for (const op of ordered) {
      const id = merged.get(op.id) ?? op.id;
      const outcome = await this.applyOne(ctx, op, id, failed, merged);
      if (!SYNC_LANDED_STATUSES.includes(outcome.status)) {
        failed.set(id, op.opId);
      }
      if (outcome.mergedInto) {
        merged.set(op.id, outcome.mergedInto);
      }
      results.push({
        opId: op.opId,
        seq: op.seq,
        entity: op.entity,
        // What the device sent, always: it matches results by it. Where the
        // write actually landed, when it differs, is `mergedInto`.
        id: op.id,
        ...outcome,
      });
    }

    return { serverTime, results };
  }

  private async applyOne(
    ctx: Context,
    op: SyncOperationInput,
    id: string,
    failed: Map<string, string>,
    merged: Map<string, string>,
  ): Promise<Outcome> {
    // The row itself counts as a dependency: a second write on a row whose
    // first write did not land would only repeat the same failure.
    const rows = [id, ...op.dependsOn.map((dep) => merged.get(dep) ?? dep)];
    const blockedBy = rows
      .map((row) => failed.get(row))
      .find((opId) => opId !== undefined);
    if (blockedBy) {
      return { status: "blocked", blockedBy };
    }

    const seen = await this.syncOps.find(ctx.userId, op.opId);
    if (seen) {
      return {
        status: "duplicate",
        ...(seen.code && { code: seen.code as ErrorCode }),
        // A merge the device may not know about yet (its response was lost);
        // the rest of this batch still names the id it minted.
        ...(seen.entityId !== op.id && { mergedInto: seen.entityId }),
      };
    }

    const outcome = await this.execute(ctx, op, id, merged);
    if (SYNC_LANDED_STATUSES.includes(outcome.status)) {
      await this.syncOps.record(ctx.userId, op.opId, {
        status: outcome.status,
        entityId: outcome.mergedInto ?? id,
        code: outcome.code ?? null,
      });
    }
    return outcome;
  }

  private async execute(
    ctx: Context,
    op: SyncOperationInput,
    id: string,
    merged: Map<string, string>,
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
      body = redirect(parsed.data as Body, handler.categoryFields, merged);
    }

    const args: RunArgs = {
      op,
      id,
      body,
      ctx,
      guard: op.baseUpdatedAt ? new Date(op.baseUpdatedAt) : undefined,
      outcome: { replayed: false },
    };
    const outcome = await this.attempt(handler, args);
    if (outcome.status === "conflict" || outcome.status === "rejected") {
      return this.reconcile(handler, args, outcome);
    }
    return outcome;
  }

  /** One pass through the route's own service, answered like the route. */
  private async attempt(handler: Handler, args: RunArgs): Promise<Outcome> {
    try {
      const result = await handler.run(args);
      return {
        status: args.outcome.replayed ? "duplicate" : "applied",
        ...(result !== undefined && { result }),
      };
    } catch (err) {
      const failure = describeFailure(err as Error);
      // Not the client's fault (database down, a bug): the whole request
      // fails, loudly. What already landed is on record and replays as
      // `duplicate` when the batch is sent again.
      if (!failure) throw err;
      const { body } = failure;
      return {
        status: failure.status === 409 ? "conflict" : "rejected",
        // Same default as PATCH /transactions/batch: without an HTTP status
        // per operation, a code-less 404 would leave the client nothing to
        // branch on.
        code:
          body.code ?? (failure.status === 404 ? "NOT_FOUND" : "BAD_REQUEST"),
        message: body.message,
        ...(body.details !== undefined && { details: body.details }),
        ...(body.current !== undefined && { current: body.current }),
      };
    }
  }

  /**
   * The reconciliation rules of ESTRATEGIA §5, applied only to what the
   * services already refused: a name taken online, a reference archived
   * online. They decide what to answer — and, for a merge, which row the
   * batch writes from here on — but never write anything themselves.
   */
  private async reconcile(
    handler: Handler,
    args: RunArgs,
    outcome: Outcome,
  ): Promise<Outcome> {
    if (outcome.code === "DUPLICATE" && handler.nameOwner) {
      return this.reconcileName(handler, args, outcome);
    }
    if (outcome.code === "CATEGORY_ARCHIVED" && handler.dropsCategory) {
      return this.dropArchivedCategory(handler, args);
    }
    if (outcome.code === "NOT_FOUND" && handler.accountFields) {
      return this.explainArchivedAccount(handler, args, outcome);
    }
    if (
      outcome.code === "NOT_FOUND" &&
      handler.removesRow &&
      (await this.transactions.isDeleted(args.id, args.ctx.userId))
    ) {
      // Another device deleted it first: the state the operation wanted
      // already holds, so it lands instead of failing (§5.4).
      return { status: "duplicate" };
    }
    return outcome;
  }

  private async reconcileName(
    handler: Handler,
    args: RunArgs,
    outcome: Outcome,
  ): Promise<Outcome> {
    const { type } = args.body as { type?: unknown };
    const name = await this.nameWritten(handler, args);
    if (name === null) return outcome;
    const taken: Account | Category | null =
      handler.nameOwner === "category"
        ? await this.categories.findActiveByName(args.ctx.userId, name)
        : await this.accounts.findActiveByName(args.ctx.userId, name);
    // Another unique index (the single default account) refused this write.
    if (!taken) return outcome;

    // Same name and same type: the two rows ARE the same category, so the
    // create lands on the server's and the batch redirects to it (§5.1). Only
    // a create: renaming an existing row onto another is not a merge.
    if (handler.create && handler.nameOwner === "category") {
      const category = taken as Category;
      if ((category.type ?? null) === ((type as string | undefined) ?? null)) {
        return { status: "merged", result: category, mergedInto: category.id };
      }
    }
    // Everything else stays a conflict, the row travelling back so the
    // device can offer the server's version without another round trip.
    return { ...outcome, current: taken };
  }

  // The name the refused write carried — or, for a restore that sent none, the
  // archived row's own name, which is what the index refused.
  private async nameWritten(
    handler: Handler,
    args: RunArgs,
  ): Promise<string | null> {
    const { name } = args.body as { name?: unknown };
    if (typeof name === "string") return name;
    if (handler.create || args.op.action !== "restore") return null;
    if (handler.nameOwner === "account") {
      const account = await this.accounts.findOwnAccount(
        args.id,
        args.ctx.userId,
      );
      return account?.name ?? null;
    }
    try {
      return (await this.categories.getCategoryById(args.id, args.ctx.userId))
        .name;
    } catch {
      // Not the user's row: the 404 the service already answered stands.
      return null;
    }
  }

  private async dropArchivedCategory(
    handler: Handler,
    args: RunArgs,
  ): Promise<Outcome> {
    // The movement is never lost (§5.3): it lands without the category and
    // flagged for review, so the user can re-file it. Nothing was written on
    // the refused attempt — the check runs before the write, and inside the
    // transaction for an update.
    const retried = await this.attempt(handler, {
      ...args,
      body: { ...args.body, categoryId: null, pendingDetails: true },
      outcome: { replayed: false },
    });
    if (!SYNC_LANDED_STATUSES.includes(retried.status)) {
      // Something else was in the way; that is the answer the device needs.
      return retried;
    }
    return { ...retried, warnings: ["CATEGORY_ARCHIVED_DROPPED"] };
  }

  private async explainArchivedAccount(
    handler: Handler,
    args: RunArgs,
    outcome: Outcome,
  ): Promise<Outcome> {
    // A bare 404 cannot tell "archived while I was offline" from "never
    // existed", and only the first one is the user's to resolve (§5.3).
    for (const field of handler.accountFields ?? []) {
      const id = args.body[field];
      if (typeof id !== "string") continue;
      const account = await this.accounts.findOwnAccount(id, args.ctx.userId);
      if (account?.archivedAt) {
        return {
          ...outcome,
          status: "conflict",
          code: "RESOURCE_ARCHIVED",
          message: "Account is archived; restore it first",
          current: account,
        };
      }
    }
    return outcome;
  }
}
