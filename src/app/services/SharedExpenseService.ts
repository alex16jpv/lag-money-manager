import {
  SharedExpense,
  SharedSplit,
} from "../../domain/entities/SharedExpense";
import { SharedGroup } from "../../domain/entities/SharedGroup";
import { ISharedExpenseRepository } from "../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import { ISharedGroupRepository } from "../../domain/repositories/sharedGroup/ISharedGroupRepository";
import { createOrReplay, CreateOutcome } from "../../shared/clientMintedId";
import { assertFresh, guardedWrite } from "../../shared/concurrency";
import { SPLIT_MODES } from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";
import { ApiError } from "../../shared/errors";
import { assertAmountPrecision } from "../../shared/money";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import {
  CreateSharedExpenseDTO,
  SplitDTO,
  UpdateSharedExpenseDTO,
} from "../dtos/SharedExpenseDTO";
import { buildSplit, inheritedSplit } from "./sharedSplitting";

export class SharedExpenseService {
  constructor(
    private repo: ISharedExpenseRepository,
    private groupRepo: ISharedGroupRepository,
  ) {}

  private async groupOfTheirs(
    groupId: string,
    userId: string,
  ): Promise<SharedGroup> {
    const group = await this.groupRepo.getByIdIncludingArchived(groupId);
    if (!group || group.userId !== userId) {
      throw new ApiError("NotFound", "Shared group not found");
    }
    return new SharedGroup(group);
  }

  private async liveGroup(
    groupId: string,
    userId: string,
  ): Promise<SharedGroup> {
    const group = await this.groupOfTheirs(groupId, userId);
    if (group.archivedAt) {
      throw new ApiError(
        "BadRequest",
        "Shared group is archived; restore it first",
        "RESOURCE_ARCHIVED",
      );
    }
    return group;
  }

  private assertPayerIsInTheGroup(
    group: SharedGroup,
    paidByContactId: string | null,
  ): void {
    if (paidByContactId === null) return;
    if (
      !group.participants.some(
        (participant) => participant.contactId === paidByContactId,
      )
    ) {
      throw new ApiError(
        "BadRequest",
        "Whoever paid has to be in the shared group",
        "PARTICIPANT_NOT_IN_GROUP",
      );
    }
  }

  private assertPrecision(
    amount: number,
    split: SplitDTO | undefined,
    currency: string,
  ): void {
    assertAmountPrecision(amount, currency, "amount");
    for (const share of split?.shares ?? []) {
      if (share.fixedAmount !== undefined && share.fixedAmount !== null) {
        assertAmountPrecision(
          share.fixedAmount,
          currency,
          "split.shares.fixedAmount",
        );
      }
    }
  }

  private splitFor(input: {
    group: SharedGroup;
    split: SplitDTO | undefined;
    amount: number;
    currency: string;
    paidByContactId: string | null;
  }): SharedSplit {
    const { group, split, amount, currency, paidByContactId } = input;
    return split
      ? buildSplit({
          split,
          participants: group.participants,
          amount,
          currency,
          paidByContactId,
        })
      : inheritedSplit({ group, amount, currency, paidByContactId });
  }

  async getExpenses(
    userId: string,
    groupId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedExpense>> {
    // A group of somebody else's must not be listable through its expenses either.
    await this.groupOfTheirs(groupId, userId);
    const result = await this.repo.getAllByGroup(userId, groupId, pagination);
    return {
      data: result.data.map((expense) => new SharedExpense(expense)),
      pagination: result.pagination,
    };
  }

  // Reads resolve deleted expenses too; only the listing hides them.
  async getExpenseById(
    id: string,
    userId: string,
    groupId?: string,
  ): Promise<SharedExpense> {
    const expense = await this.repo.getByIdIncludingDeleted(id);
    if (
      !expense ||
      expense.userId !== userId ||
      (groupId !== undefined && expense.groupId !== groupId)
    ) {
      throw new ApiError("NotFound", "Shared expense not found");
    }
    return new SharedExpense(expense);
  }

  async createExpense(
    dto: CreateSharedExpenseDTO,
    outcome?: CreateOutcome,
  ): Promise<SharedExpense> {
    return createOrReplay({
      clientId: dto.id,
      outcome,
      findOwn: (id) => this.repo.getOwnById(id, dto.userId),
      replay: async (expense) => new SharedExpense(expense),
      create: () => this.insertExpense(dto),
    });
  }

  private async insertExpense(
    dto: CreateSharedExpenseDTO,
  ): Promise<SharedExpense> {
    const group = await this.liveGroup(dto.groupId, dto.userId);
    const currency = group.currency ?? DEFAULT_CURRENCY;
    const paidByContactId = dto.paidByContactId ?? null;
    this.assertPayerIsInTheGroup(group, paidByContactId);
    this.assertPrecision(dto.amount, dto.split, currency);

    const expense = new SharedExpense({
      id: dto.id,
      groupId: dto.groupId,
      description: dto.description ?? null,
      date: dto.date,
      amount: dto.amount,
      paidByContactId,
      split: this.splitFor({
        group,
        split: dto.split,
        amount: dto.amount,
        currency,
        paidByContactId,
      }),
      customSplit: Boolean(dto.split),
      userId: dto.userId,
      currency,
    });
    expense.assertValid();
    return new SharedExpense(await this.repo.create(expense));
  }

  async updateExpense(
    id: string,
    dto: UpdateSharedExpenseDTO,
    userId: string,
    expectedUpdatedAt?: Date,
    groupId?: string,
  ): Promise<SharedExpense> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Shared expense id does not match");
    }
    if (dto.split && dto.useGroupSplit) {
      throw new ApiError(
        "BadRequest",
        "An expense either carries its own split or follows the group's",
        "SPLIT_INVALID",
      );
    }
    const existing = await this.getExpenseById(id, userId, groupId);
    assertFresh(existing, expectedUpdatedAt, (e) => new SharedExpense(e));
    if (existing.deletedAt) {
      throw new ApiError(
        "BadRequest",
        "Shared expense is deleted",
        "RESOURCE_ARCHIVED",
      );
    }

    const group = await this.liveGroup(existing.groupId, userId);
    const currency = group.currency ?? DEFAULT_CURRENCY;
    const amount = dto.amount ?? existing.amount;
    const paidByContactId =
      dto.paidByContactId !== undefined
        ? dto.paidByContactId
        : existing.paidByContactId;
    this.assertPayerIsInTheGroup(group, paidByContactId);
    this.assertPrecision(amount, dto.split, currency);

    const merged = new SharedExpense({
      ...existing,
      description:
        dto.description !== undefined ? dto.description : existing.description,
      date: dto.date ?? existing.date,
      amount,
      paidByContactId,
      split: existing.split,
      customSplit: existing.customSplit,
    });
    merged.assertValid();

    const write: Partial<SharedExpense> = {
      description: merged.description,
      date: merged.date,
      amount: merged.amount,
      paidByContactId: merged.paidByContactId,
    };
    // Any of the three moves the figures, so the split is resolved again rather than left stale.
    const resplit =
      dto.split !== undefined ||
      dto.useGroupSplit === true ||
      dto.amount !== undefined ||
      dto.paidByContactId !== undefined;
    if (resplit) {
      const stated =
        dto.split ??
        (existing.customSplit && !dto.useGroupSplit
          ? this.asSplitInput(existing.split)
          : undefined);
      write.split = this.splitFor({
        group,
        split: stated,
        amount,
        currency,
        paidByContactId,
      });
      write.customSplit = stated !== undefined;
    }

    return guardedWrite(
      expectedUpdatedAt,
      async () =>
        new SharedExpense(
          await this.repo.update(id, write, undefined, expectedUpdatedAt),
        ),
      () => this.repo.getOwnById(id, userId),
      (e) => new SharedExpense(e),
    );
  }

  // A stored split states the same thing a request does; only the resolved amounts are dropped.
  private asSplitInput(split: SharedSplit): SplitDTO {
    return {
      mode: split.mode,
      guests: split.guests ?? null,
      shares: split.shares.map((share) => ({
        party: share.party,
        contactId: share.contactId ?? null,
        percent: split.mode === SPLIT_MODES.PERCENT ? share.percent : null,
        fixedAmount:
          split.mode === SPLIT_MODES.PERCENT ? null : share.fixedAmount,
      })),
    };
  }

  // Idempotent, and it answers the deleted row so a queued write can guard on its updatedAt.
  async deleteExpense(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
    groupId?: string,
  ): Promise<SharedExpense> {
    const existing = await this.getExpenseById(id, userId, groupId);
    assertFresh(existing, expectedUpdatedAt, (e) => new SharedExpense(e));
    if (existing.deletedAt) {
      return new SharedExpense(existing);
    }
    return new SharedExpense(
      await this.repo.delete(id, undefined, expectedUpdatedAt),
    );
  }
}
