import { SharedExpense } from "../../domain/entities/SharedExpense";
import {
  SharedGroup,
  SharedParticipant,
} from "../../domain/entities/SharedGroup";
import { IContactRepository } from "../../domain/repositories/contact/IContactRepository";
import { ISharedExpenseRepository } from "../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import {
  ISharedGroupRepository,
  SharedGroupFilters,
} from "../../domain/repositories/sharedGroup/ISharedGroupRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { createOrReplay, CreateOutcome } from "../../shared/clientMintedId";
import { assertFresh, guardedWrite } from "../../shared/concurrency";
import { MAX_GROUP_PARTICIPANTS, SPLIT_MODES } from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";
import { ApiError } from "../../shared/errors";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { TxSession, withTransaction } from "../../shared/unitOfWork";
import {
  AddParticipantsDTO,
  CreateSharedGroupDTO,
  DefaultSplitDTO,
  UpdateSharedGroupDTO,
} from "../dtos/SharedGroupDTO";
import {
  assertDefaultSplit,
  rescaleDefaultSplit,
  resplitForNewParticipants,
  sharesByParticipant,
} from "./sharedSplitting";

export interface GroupTotalsView {
  amount: number;
  yourShare: number;
  expenseCount: number;
  dateFrom: Date | null;
  dateTo: Date | null;
}

/** A group plus what its expenses add up to; the range is derived, never stored. */
export type SharedGroupView = SharedGroup & { totals: GroupTotalsView };

export interface ParticipantChange {
  contactId: string | null;
  shareBefore: number;
  shareAfter: number;
}

export interface AddParticipantsPreview {
  participants: ParticipantChange[];
  expenses: { total: number; resplit: number; untouched: number };
}

const EMPTY_TOTALS: GroupTotalsView = {
  amount: 0,
  yourShare: 0,
  expenseCount: 0,
  dateFrom: null,
  dateTo: null,
};

export class SharedGroupService {
  constructor(
    private repo: ISharedGroupRepository,
    private expenseRepo: ISharedExpenseRepository,
    private contactRepo: IContactRepository,
    private userRepo: IUserRepository,
  ) {}

  private async withTotals(
    userId: string,
    groups: SharedGroup[],
  ): Promise<SharedGroupView[]> {
    const totals = await this.expenseRepo.totalsByGroup(
      userId,
      groups.map((group) => group.id),
    );
    const byGroup = new Map(totals.map((row) => [row.groupId, row]));
    return groups.map((group) => {
      const row = byGroup.get(group.id);
      return Object.assign(new SharedGroup(group), {
        totals: row
          ? {
              amount: row.total,
              yourShare: row.yourShare,
              expenseCount: row.expenseCount,
              dateFrom: row.dateFrom,
              dateTo: row.dateTo,
            }
          : EMPTY_TOTALS,
      });
    });
  }

  async getAllGroups(
    userId: string,
    pagination: PaginationParams,
    filters?: SharedGroupFilters,
  ): Promise<PaginatedResult<SharedGroupView>> {
    const result = await this.repo.getAllByUserId(userId, pagination, filters);
    return {
      data: await this.withTotals(userId, result.data),
      pagination: result.pagination,
    };
  }

  // Reads resolve archived groups too; only the listing hides them by default.
  async getGroupById(id: string, userId: string): Promise<SharedGroupView> {
    const group = await this.ownedGroup(id, userId);
    const [view] = await this.withTotals(userId, [group]);
    return view as SharedGroupView;
  }

  private async ownedGroup(id: string, userId: string): Promise<SharedGroup> {
    const group = await this.repo.getByIdIncludingArchived(id);
    if (!group || group.userId !== userId) {
      throw new ApiError("NotFound", "Shared group not found");
    }
    return new SharedGroup(group);
  }

  private async assertContactsAreTheirs(
    userId: string,
    contactIds: string[],
  ): Promise<void> {
    if (contactIds.length === 0) return;
    const active = new Set(
      await this.contactRepo.listActiveIds(userId, contactIds),
    );
    if (contactIds.some((id) => !active.has(id))) {
      throw new ApiError("NotFound", "Contact not found");
    }
  }

  private assertRoomFor(count: number): void {
    if (count > MAX_GROUP_PARTICIPANTS) {
      throw new ApiError(
        "BadRequest",
        `A shared group holds at most ${MAX_GROUP_PARTICIPANTS} people, you included`,
        "PARTICIPANT_LIMIT_REACHED",
      );
    }
  }

  private async currencyOf(userId: string): Promise<string> {
    const owner = await this.userRepo.getById(userId);
    return owner?.currency ?? DEFAULT_CURRENCY;
  }

  async createGroup(
    dto: CreateSharedGroupDTO,
    outcome?: CreateOutcome,
  ): Promise<SharedGroupView> {
    return createOrReplay({
      clientId: dto.id,
      outcome,
      findOwn: (id) => this.repo.getOwnById(id, dto.userId),
      replay: async (group) =>
        (await this.withTotals(dto.userId, [group]))[0] as SharedGroupView,
      create: () => this.insertGroup(dto),
    });
  }

  private async insertGroup(
    dto: CreateSharedGroupDTO,
  ): Promise<SharedGroupView> {
    const contactIds = [...new Set(dto.contactIds ?? [])];
    if (contactIds.length !== (dto.contactIds ?? []).length) {
      throw new ApiError(
        "BadRequest",
        "The same person cannot be in a group twice",
        "PARTICIPANT_ALREADY_IN_GROUP",
      );
    }
    await this.assertContactsAreTheirs(dto.userId, contactIds);
    const addedAt = new Date();
    const participants: SharedParticipant[] = [
      { contactId: null, addedAt },
      ...contactIds.map((contactId) => ({ contactId, addedAt })),
    ];
    this.assertRoomFor(participants.length);

    const defaultSplit = assertDefaultSplit(
      dto.defaultSplit ?? { mode: SPLIT_MODES.EQUAL },
      participants,
    );
    const created = await this.repo.create(
      new SharedGroup({
        id: dto.id,
        name: dto.name,
        color: dto.color,
        participants,
        defaultSplit,
        userId: dto.userId,
        currency: await this.currencyOf(dto.userId),
      }),
    );
    return Object.assign(new SharedGroup(created), { totals: EMPTY_TOTALS });
  }

  async updateGroup(
    id: string,
    dto: UpdateSharedGroupDTO,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroupView> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Shared group id does not match");
    }
    const existing = await this.ownedGroup(id, userId);
    assertFresh(existing, expectedUpdatedAt, (g) => new SharedGroup(g));
    if (existing.archivedAt) {
      throw new ApiError(
        "BadRequest",
        "Shared group is archived; restore it first",
        "RESOURCE_ARCHIVED",
      );
    }

    const write: Partial<SharedGroup> = {};
    if (dto.name !== undefined) write.name = dto.name;
    if (dto.color !== undefined) write.color = dto.color ?? undefined;
    if (dto.defaultSplit !== undefined) {
      // Changing the default is never retroactive: it applies to what is added from now on.
      write.defaultSplit = assertDefaultSplit(
        dto.defaultSplit,
        existing.participants,
      );
    }

    const updated = await guardedWrite(
      expectedUpdatedAt,
      () => this.repo.update(id, write, undefined, expectedUpdatedAt),
      () => this.repo.getOwnById(id, userId),
      (g) => new SharedGroup(g),
    );
    const [view] = await this.withTotals(userId, [updated]);
    return view as SharedGroupView;
  }

  // Idempotent, and it answers the archived row so a queued restore can guard on its updatedAt.
  async deleteGroup(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroupView> {
    const existing = await this.ownedGroup(id, userId);
    assertFresh(existing, expectedUpdatedAt, (g) => new SharedGroup(g));
    const archived = existing.archivedAt
      ? existing
      : await this.repo.delete(id, undefined, expectedUpdatedAt);
    const [view] = await this.withTotals(userId, [archived]);
    return view as SharedGroupView;
  }

  // Idempotent: restoring an already-active group returns it unchanged.
  async restoreGroup(
    id: string,
    userId: string,
    name?: string,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroupView> {
    const restored =
      (await this.repo.restore(id, userId, name, expectedUpdatedAt)) ??
      (await this.ownedGroup(id, userId));
    assertFresh(restored, expectedUpdatedAt, (g) => new SharedGroup(g));
    const [view] = await this.withTotals(userId, [restored]);
    return view as SharedGroupView;
  }

  private async plannedParticipants(
    group: SharedGroup,
    dto: AddParticipantsDTO,
    userId: string,
  ): Promise<{
    contactIds: string[];
    participants: SharedParticipant[];
    defaultSplit: ReturnType<typeof assertDefaultSplit>;
  }> {
    const contactIds = [...new Set(dto.contactIds)];
    const already = new Set(
      group.participants.map((participant) => participant.contactId),
    );
    if (contactIds.some((contactId) => already.has(contactId))) {
      throw new ApiError(
        "BadRequest",
        "Somebody in this list is already in the group",
        "PARTICIPANT_ALREADY_IN_GROUP",
      );
    }
    await this.assertContactsAreTheirs(userId, contactIds);

    const addedAt = new Date();
    const participants: SharedParticipant[] = [
      ...group.participants,
      ...contactIds.map((contactId) => ({ contactId, addedAt })),
    ];
    this.assertRoomFor(participants.length);

    const stated: DefaultSplitDTO | undefined = dto.defaultSplit;
    if (!stated && group.defaultSplit.mode === SPLIT_MODES.PERCENT) {
      throw new ApiError(
        "BadRequest",
        "This group splits by percentage, so adding somebody needs the new percentages",
        "SPLIT_INVALID",
      );
    }
    return {
      contactIds,
      participants,
      defaultSplit: assertDefaultSplit(
        stated ?? group.defaultSplit,
        participants,
      ),
    };
  }

  private async simulate(
    plannedGroup: SharedGroup,
    contactIds: string[],
    apply: boolean,
    session?: TxSession,
  ): Promise<{
    preview: AddParticipantsPreview;
    updates: { id: string; split: SharedExpense["split"] }[];
  }> {
    const currency = plannedGroup.currency ?? DEFAULT_CURRENCY;
    const expenses = await this.expenseRepo.listByGroup(
      plannedGroup.userId,
      plannedGroup.id,
      session,
    );
    const before = sharesByParticipant(expenses);
    const updates: { id: string; split: SharedExpense["split"] }[] = [];
    const after = apply
      ? expenses.map((expense) => {
          const split = resplitForNewParticipants({
            expense,
            group: plannedGroup,
            newContactIds: contactIds,
            currency,
          });
          if (split) updates.push({ id: expense.id, split });
          return { split: split ?? expense.split };
        })
      : expenses;
    const afterTotals = sharesByParticipant(after);

    return {
      preview: {
        participants: plannedGroup.participants.map((participant) => ({
          contactId: participant.contactId,
          shareBefore: before.get(participant.contactId) ?? 0,
          shareAfter: afterTotals.get(participant.contactId) ?? 0,
        })),
        expenses: {
          total: expenses.length,
          resplit: updates.length,
          untouched: expenses.length - updates.length,
        },
      },
      updates,
    };
  }

  private async plan(
    id: string,
    dto: AddParticipantsDTO,
    userId: string,
  ): Promise<{
    group: SharedGroup;
    plannedGroup: SharedGroup;
    contactIds: string[];
  }> {
    const group = await this.ownedGroup(id, userId);
    if (group.archivedAt) {
      throw new ApiError(
        "BadRequest",
        "Shared group is archived; restore it first",
        "RESOURCE_ARCHIVED",
      );
    }
    const { contactIds, participants, defaultSplit } =
      await this.plannedParticipants(group, dto, userId);
    const plannedGroup = new SharedGroup({
      ...group,
      participants,
      defaultSplit,
    });
    return { group, plannedGroup, contactIds };
  }

  /** The whole result of adding people, worked out and thrown away: nothing is written. */
  async previewParticipants(
    id: string,
    dto: AddParticipantsDTO,
    userId: string,
  ): Promise<AddParticipantsPreview> {
    const { plannedGroup, contactIds } = await this.plan(id, dto, userId);
    const { preview } = await this.simulate(
      plannedGroup,
      contactIds,
      dto.applyToExistingExpenses ?? false,
    );
    return preview;
  }

  async addParticipants(
    id: string,
    dto: AddParticipantsDTO,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<{ group: SharedGroupView; applied: AddParticipantsPreview }> {
    const { group, plannedGroup, contactIds } = await this.plan(
      id,
      dto,
      userId,
    );
    assertFresh(group, expectedUpdatedAt, (g) => new SharedGroup(g));

    // Read and written in the same transaction: an expense added in between would keep the old split.
    const { updated, preview } = await guardedWrite(
      expectedUpdatedAt,
      () =>
        withTransaction(async (session) => {
          const plan = await this.simulate(
            plannedGroup,
            contactIds,
            dto.applyToExistingExpenses ?? false,
            session,
          );
          await this.expenseRepo.replaceSplits(plan.updates, session);
          return {
            updated: await this.repo.update(
              id,
              {
                participants: plannedGroup.participants,
                defaultSplit: plannedGroup.defaultSplit,
              },
              session,
              expectedUpdatedAt,
            ),
            preview: plan.preview,
          };
        }),
      () => this.repo.getOwnById(id, userId),
      (g) => new SharedGroup(g),
    );
    const [view] = await this.withTotals(userId, [updated]);
    return { group: view as SharedGroupView, applied: preview };
  }

  async removeParticipant(
    id: string,
    contactId: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroupView> {
    const group = await this.ownedGroup(id, userId);
    assertFresh(group, expectedUpdatedAt, (g) => new SharedGroup(g));
    if (group.archivedAt) {
      throw new ApiError(
        "BadRequest",
        "Shared group is archived; restore it first",
        "RESOURCE_ARCHIVED",
      );
    }
    if (
      !group.participants.some(
        (participant) => participant.contactId === contactId,
      )
    ) {
      throw new ApiError(
        "BadRequest",
        "That person is not in this shared group",
        "PARTICIPANT_NOT_IN_GROUP",
      );
    }
    const shares = await this.expenseRepo.countSharesOfContact(
      userId,
      id,
      contactId,
    );
    if (shares > 0) {
      throw new ApiError(
        "BadRequest",
        "That person has a share of an expense here; settle it or write it off instead",
        "PARTICIPANT_IN_USE",
      );
    }

    const updated = await guardedWrite(
      expectedUpdatedAt,
      () =>
        this.repo.update(
          id,
          {
            participants: group.participants.filter(
              (participant) => participant.contactId !== contactId,
            ),
            defaultSplit: rescaleDefaultSplit(group.defaultSplit, contactId),
          },
          undefined,
          expectedUpdatedAt,
        ),
      () => this.repo.getOwnById(id, userId),
      (g) => new SharedGroup(g),
    );
    const [view] = await this.withTotals(userId, [updated]);
    return view as SharedGroupView;
  }
}
