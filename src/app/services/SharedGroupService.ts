import { SharedExpense } from "../../domain/entities/SharedExpense";
import {
  SharedGroup,
  SharedParticipant,
  SharedWriteOff,
} from "../../domain/entities/SharedGroup";
import { SettlementCounterparty } from "../../domain/entities/SharedSettlement";
import { IContactRepository } from "../../domain/repositories/contact/IContactRepository";
import { ISharedExpenseRepository } from "../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import {
  ISharedGroupRepository,
  SharedGroupFilters,
} from "../../domain/repositories/sharedGroup/ISharedGroupRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { createOrReplay, CreateOutcome } from "../../shared/clientMintedId";
import { assertFresh, guardedWrite } from "../../shared/concurrency";
import {
  GROUP_STATUSES,
  GroupStatus,
  MAX_GROUP_PARTICIPANTS,
  SETTLEMENT_PARTIES,
  SHARE_PARTIES,
  SHARED_HISTORY_REASONS,
  SharedHistoryReason,
  SPLIT_MODES,
} from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";
import { ApiError } from "../../shared/errors";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { TxSession, withTransaction } from "../../shared/unitOfWork";
import {
  AddParticipantsDTO,
  CreateSharedGroupDTO,
  DefaultSplitDTO,
  UpdateSharedGroupDTO,
  WriteOffDTO,
} from "../dtos/SharedGroupDTO";
import { stampSharedChange } from "./sharedLedger";
import { counterpartiesOf, SharedLedgerService } from "./SharedLedgerService";
import {
  assertDefaultSplit,
  rescaleDefaultSplit,
  resplitForNewParticipants,
  sharesByParticipant,
} from "./sharedSplitting";

export interface GroupTotalsView {
  amount: number;
  yourShare: number;
  owedToYou: number;
  youOwe: number;
  collected: number;
  // What you have given up on here. It is not owed any more, and it was always counted as yours.
  writtenOff: number;
  expenseCount: number;
  dateFrom: Date | null;
  dateTo: Date | null;
}

/** A group plus what its expenses add up to; the range and the state are derived, never stored. */
export type SharedGroupView = SharedGroup & {
  totals: GroupTotalsView;
  status: GroupStatus;
};

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
  owedToYou: 0,
  youOwe: 0,
  collected: 0,
  writtenOff: 0,
  expenseCount: 0,
  dateFrom: null,
  dateTo: null,
};

const partyKey = (party: {
  contactId: string | null;
  expenseId: string | null;
}): string =>
  party.expenseId ? `guests:${party.expenseId}` : `contact:${party.contactId}`;

const asWriteOff = (party: SettlementCounterparty): SharedWriteOff => ({
  kind: party.kind,
  contactId: party.contactId,
  expenseId: party.expenseId,
  at: new Date(),
});

/** What the people you have given up on still owe, which is what stops being owed. */
function writtenOffIn(
  group: SharedGroup,
  owedByParty: {
    contactId: string | null;
    expenseId: string | null;
    owed: number;
  }[],
): number {
  if (group.writeOffs.length === 0) return 0;
  const given = new Set(group.writeOffs.map(partyKey));
  return owedByParty
    .filter((party) => given.has(partyKey(party)))
    .reduce((sum, party) => sum + party.owed, 0);
}

/** Open until nobody owes anybody here, by paying or by being written off. */
const statusOf = (totals: GroupTotalsView): GroupStatus =>
  totals.owedToYou === 0 && totals.youOwe === 0
    ? GROUP_STATUSES.SETTLED
    : GROUP_STATUSES.OPEN;

export class SharedGroupService {
  constructor(
    private repo: ISharedGroupRepository,
    private expenseRepo: ISharedExpenseRepository,
    private contactRepo: IContactRepository,
    private userRepo: IUserRepository,
    private transactionRepo: ITransactionRepository,
    private ledger: SharedLedgerService,
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
      const writtenOff = row ? writtenOffIn(group, row.owedByParty) : 0;
      const view: GroupTotalsView = row
        ? {
            amount: row.total,
            yourShare: row.yourShare,
            // What has been given up on is not owed any more, here or in the state below.
            owedToYou: row.owedToYou - writtenOff,
            youOwe: row.youOwe,
            collected: row.collected,
            writtenOff,
            expenseCount: row.expenseCount,
            dateFrom: row.dateFrom,
            dateTo: row.dateTo,
          }
        : EMPTY_TOTALS;
      return Object.assign(new SharedGroup(group), {
        totals: view,
        status: statusOf(view),
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
    return Object.assign(new SharedGroup(created), {
      totals: EMPTY_TOTALS,
      status: statusOf(EMPTY_TOTALS),
    });
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
  /**
   * Archiving a group where people still owe **writes those amounts off on
   * your behalf** — his decision, in his words. No figure moves: that money
   * was counted as yours the day it left.
   */
  async deleteGroup(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroupView> {
    const existing = await this.ownedGroup(id, userId);
    assertFresh(existing, expectedUpdatedAt, (g) => new SharedGroup(g));
    if (existing.archivedAt) {
      const [already] = await this.withTotals(userId, [existing]);
      return already as SharedGroupView;
    }
    return withTransaction(async (session) => {
      const owing = await this.stillOwing(existing, session);
      const writeOffs = [...existing.writeOffs, ...owing.map(asWriteOff)];
      if (owing.length > 0) {
        await this.repo.update(id, { writeOffs }, session);
        await this.recordWriteOff(
          existing,
          owing,
          SHARED_HISTORY_REASONS.WRITE_OFF,
          session,
        );
      }
      const archived = await this.repo.delete(
        id,
        session,
        // The write-off above already moved the version the caller was holding.
        owing.length > 0 ? undefined : expectedUpdatedAt,
      );
      const [view] = await this.withTotals(userId, [archived]);
      return view as SharedGroupView;
    });
  }

  /** Giving up on what one person, or one block of guests, still owes here. */
  async writeOff(
    id: string,
    dto: WriteOffDTO,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroupView> {
    const group = await this.openGroup(id, userId, expectedUpdatedAt);
    const party = await this.writeOffParty(group, dto);
    const key = partyKey(party);
    if (group.writeOffs.some((one) => partyKey(one) === key)) {
      return this.viewOf(userId, group);
    }
    return withTransaction(async (session) =>
      this.saveWriteOffs(
        group,
        [...group.writeOffs, asWriteOff(party)],
        [party],
        SHARED_HISTORY_REASONS.WRITE_OFF,
        session,
        expectedUpdatedAt,
      ),
    );
  }

  /** Undone while the group is open, which is the only time it can be. */
  async undoWriteOff(
    id: string,
    partyId: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroupView> {
    const group = await this.openGroup(id, userId, expectedUpdatedAt);
    // The stored entry already knows whether it is a person or a block of guests.
    const entry = group.writeOffs.find(
      (one) => one.contactId === partyId || one.expenseId === partyId,
    );
    if (!entry) return this.viewOf(userId, group);
    const key = partyKey(entry);
    return withTransaction(async (session) =>
      this.saveWriteOffs(
        group,
        group.writeOffs.filter((one) => partyKey(one) !== key),
        [entry],
        SHARED_HISTORY_REASONS.WRITE_OFF_UNDONE,
        session,
        expectedUpdatedAt,
      ),
    );
  }

  private async saveWriteOffs(
    group: SharedGroup,
    writeOffs: SharedWriteOff[],
    touched: SettlementCounterparty[],
    reason: SharedHistoryReason,
    session: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroupView> {
    const saved = await this.repo.update(
      group.id,
      { writeOffs },
      session,
      expectedUpdatedAt,
    );
    await this.recordWriteOff(group, touched, reason, session);
    return this.viewOf(group.userId, saved);
  }

  private async openGroup(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroup> {
    const group = await this.ownedGroup(id, userId);
    assertFresh(group, expectedUpdatedAt, (g) => new SharedGroup(g));
    if (group.archivedAt) {
      throw new ApiError(
        "BadRequest",
        "Shared group is archived; restore it first",
        "RESOURCE_ARCHIVED",
      );
    }
    return group;
  }

  private async viewOf(
    userId: string,
    group: SharedGroup,
  ): Promise<SharedGroupView> {
    const [view] = await this.withTotals(userId, [group]);
    return view as SharedGroupView;
  }

  /** The people and blocks of this group that still owe something, write-offs aside. */
  private async stillOwing(
    group: SharedGroup,
    session: TxSession,
  ): Promise<SettlementCounterparty[]> {
    const given = new Set(group.writeOffs.map(partyKey));
    const expenses = await this.expenseRepo.listByGroup(
      group.userId,
      group.id,
      session,
    );
    const owed = new Map<string, SettlementCounterparty>();
    for (const expense of expenses) {
      if (expense.paidByContactId !== null) continue;
      for (const share of expense.split.shares) {
        if (share.party === SHARE_PARTIES.USER) continue;
        if (share.amount - share.collected <= 0) continue;
        const party: SettlementCounterparty =
          share.party === SHARE_PARTIES.GUESTS
            ? {
                kind: SETTLEMENT_PARTIES.GUESTS,
                contactId: null,
                expenseId: expense.id,
              }
            : {
                kind: SETTLEMENT_PARTIES.CONTACT,
                contactId: share.contactId,
                expenseId: null,
              };
        const key = partyKey(party);
        if (!given.has(key)) owed.set(key, party);
      }
    }
    return [...owed.values()];
  }

  /** It moves no figure, and the history of every movement it touches says exactly that. */
  private async recordWriteOff(
    group: SharedGroup,
    parties: { contactId: string | null; expenseId: string | null }[],
    reason: SharedHistoryReason,
    session: TxSession,
  ): Promise<void> {
    const keys = new Set(parties.map(partyKey));
    const expenses = await this.expenseRepo.listByGroup(
      group.userId,
      group.id,
      session,
    );
    const touched = expenses.filter(
      (expense) =>
        expense.paidByContactId === null &&
        counterpartiesOf(expense).some((party) => keys.has(partyKey(party))),
    );
    if (touched.length === 0) return;
    const movements = await this.transactionRepo.listBySharedExpenseIds(
      group.userId,
      touched.map((expense) => expense.id),
      session,
    );
    for (const movement of movements) {
      await stampSharedChange(this.transactionRepo, session, movement, reason);
    }
  }

  private async writeOffParty(
    group: SharedGroup,
    dto: WriteOffDTO,
  ): Promise<SettlementCounterparty> {
    if (dto.contactId) {
      if (
        !group.participants.some(
          (participant) => participant.contactId === dto.contactId,
        )
      ) {
        throw new ApiError(
          "BadRequest",
          "That person is not in this shared group",
          "PARTICIPANT_NOT_IN_GROUP",
        );
      }
      return {
        kind: SETTLEMENT_PARTIES.CONTACT,
        contactId: dto.contactId,
        expenseId: null,
      };
    }
    const expense = await this.expenseRepo.getById(dto.expenseId as string);
    if (
      !expense ||
      expense.userId !== group.userId ||
      expense.groupId !== group.id
    ) {
      throw new ApiError("NotFound", "Shared expense not found");
    }
    if (!expense.split.guests) {
      throw new ApiError(
        "BadRequest",
        "That expense has no block of guests to write off",
        "VALIDATION",
      );
    }
    return {
      kind: SETTLEMENT_PARTIES.GUESTS,
      contactId: null,
      expenseId: expense.id,
    };
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
    // The expenses as they are left, which is what their people's payments are imputed over.
    resplit: SharedExpense[];
  }> {
    const currency = plannedGroup.currency ?? DEFAULT_CURRENCY;
    const expenses = await this.expenseRepo.listByGroup(
      plannedGroup.userId,
      plannedGroup.id,
      session,
    );
    const before = sharesByParticipant(expenses);
    const updates: { id: string; split: SharedExpense["split"] }[] = [];
    const resplit: SharedExpense[] = [];
    const after = apply
      ? expenses.map((expense) => {
          const split = resplitForNewParticipants({
            expense,
            group: plannedGroup,
            newContactIds: contactIds,
            currency,
          });
          if (split) {
            updates.push({ id: expense.id, split });
            resplit.push(new SharedExpense({ ...expense, split }));
          }
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
      resplit,
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
          await this.recordResplit(userId, plan.resplit, session);
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

  /**
   * A re-split changes what each person owes, so their payments are imputed
   * over it again and every movement it touches says so in its history — once,
   * whether or not what counts as yours moved with it.
   */
  private async recordResplit(
    userId: string,
    expenses: SharedExpense[],
    session: TxSession,
  ): Promise<void> {
    if (expenses.length === 0) return;
    const { stamped } = await this.ledger.recompute(
      userId,
      expenses.flatMap(counterpartiesOf),
      SHARED_HISTORY_REASONS.SPLIT_EDITED,
      session,
    );
    const movements = await this.transactionRepo.listBySharedExpenseIds(
      userId,
      expenses.map((expense) => expense.id),
      session,
    );
    for (const movement of movements) {
      if (stamped.has(movement.sharedExpenseId as string)) continue;
      await stampSharedChange(
        this.transactionRepo,
        session,
        movement,
        SHARED_HISTORY_REASONS.SPLIT_EDITED,
      );
    }
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
