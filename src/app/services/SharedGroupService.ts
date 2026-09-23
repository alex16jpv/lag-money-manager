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
import { ISharedInvitationRepository } from "../../domain/repositories/sharedInvitation/ISharedInvitationRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { createOrReplay, CreateOutcome } from "../../shared/clientMintedId";
import { assertFresh, guardedWrite } from "../../shared/concurrency";
import {
  GROUP_STATUSES,
  GroupStatus,
  INVITATION_STATUSES,
  MAX_GROUP_PARTICIPANTS,
  SETTLEMENT_PARTIES,
  SHARED_HISTORY_REASONS,
  SharedHistoryReason,
  SPLIT_MODES,
} from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";
import { ApiError } from "../../shared/errors";
import { fromCents, toCents } from "../../shared/money";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { TxSession, withTransaction } from "../../shared/unitOfWork";
import {
  AddParticipantsDTO,
  CreateSharedGroupDTO,
  DefaultSplitDTO,
  UpdateSharedGroupDTO,
  WriteOffDTO,
} from "../dtos/SharedGroupDTO";
import { RestampJournal, WithRestamps } from "./restamps";
import { stampSharedChange } from "./sharedLedger";
import {
  counterpartiesOf,
  counterpartyKey,
  counterpartyOfShare,
  SharedLedgerService,
} from "./SharedLedgerService";
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

/** What one person, or one block of guests, still owes you here, in whole cents. */
interface OpenAmount {
  cents: number;
  expenseIds: string[];
}

function writeOffOf(
  key: string,
  open: Map<string, OpenAmount>,
  party?: SettlementCounterparty,
): SharedWriteOff {
  const [kind, id] = key.split(":");
  const named: SettlementCounterparty = party ?? {
    kind:
      kind === "guests"
        ? SETTLEMENT_PARTIES.GUESTS
        : SETTLEMENT_PARTIES.CONTACT,
    contactId: kind === "guests" ? null : (id as string),
    expenseId: kind === "guests" ? (id as string) : null,
  };
  return {
    ...named,
    amount: fromCents(open.get(key)?.cents ?? 0),
    at: new Date(),
  };
}

function openByParty(expenses: SharedExpense[]): Map<string, OpenAmount> {
  const open = new Map<string, OpenAmount>();
  for (const expense of expenses) {
    // Only a line you fronted is money owed to you.
    if (expense.paidByContactId !== null) continue;
    for (const share of expense.split.shares) {
      const party = counterpartyOfShare(expense, share);
      if (!party) continue;
      const cents = toCents(share.amount) - toCents(share.collected);
      if (cents <= 0) continue;
      const key = counterpartyKey(party);
      const row = open.get(key) ?? { cents: 0, expenseIds: [] };
      row.cents += cents;
      row.expenseIds.push(expense.id);
      open.set(key, row);
    }
  }
  return open;
}

/**
 * What is given up on: never more than was open when it was decided, and never
 * more than is open now, so a share that falls takes the write-off down with it
 * and a debt that appears later is owed like any other.
 */
function writtenOffCents(
  group: SharedGroup,
  owedByParty: {
    contactId: string | null;
    expenseId: string | null;
    owedCents: number;
  }[],
): number {
  if (group.writeOffs.length === 0) return 0;
  const open = new Map(
    owedByParty.map((party) => [
      party.expenseId
        ? `guests:${party.expenseId}`
        : `contact:${party.contactId}`,
      party.owedCents,
    ]),
  );
  return group.writeOffs.reduce(
    (sum, one) =>
      sum + Math.min(toCents(one.amount), open.get(counterpartyKey(one)) ?? 0),
    0,
  );
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
    private invitationRepo: ISharedInvitationRepository,
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
      // In whole cents: two sums of decimals do not cancel, and `SETTLED` is an equality with zero.
      const given = row ? writtenOffCents(group, row.owedByParty) : 0;
      const view: GroupTotalsView = row
        ? {
            amount: row.total,
            yourShare: row.yourShare,
            // What has been given up on is not owed any more, here or in the state below.
            owedToYou: fromCents(toCents(row.owedToYou) - given),
            youOwe: row.youOwe,
            collected: row.collected,
            writtenOff: fromCents(given),
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
      () =>
        withTransaction(async (session) => {
          const group = await this.repo.update(
            id,
            write,
            session,
            expectedUpdatedAt,
          );
          if (write.name !== undefined || dto.color !== undefined) {
            await this.invitationRepo.refreshGroup(
              userId,
              id,
              { groupName: group.name, groupColor: group.color },
              session,
            );
          }
          return group;
        }),
      () => this.repo.getOwnById(id, userId),
      (g) => new SharedGroup(g),
    );
    const [view] = await this.withTotals(userId, [updated]);
    return view as SharedGroupView;
  }

  // Idempotent, and it answers the archived row so a queued restore can guard on its updatedAt.
  /**
   * Archiving a group where people still owe writes those amounts off on your
   * behalf, which is the owner's decision in his words. No figure moves.
   */
  async deleteGroup(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<WithRestamps<SharedGroupView>> {
    const existing = await this.ownedGroup(id, userId);
    assertFresh(existing, expectedUpdatedAt, (g) => new SharedGroup(g));
    if (existing.archivedAt) {
      return Object.assign(await this.viewOf(userId, existing), {
        restamped: [],
      });
    }

    return guardedWrite(
      expectedUpdatedAt,
      () =>
        withTransaction(async (session) => {
          const journal = new RestampJournal();
          const group = await this.groupInSession(id, userId, session);
          await this.invitationRepo.withdrawAll(
            { userId, groupId: id, statuses: [INVITATION_STATUSES.PENDING] },
            new Date(),
            session,
          );
          const open = openByParty(
            await this.expenseRepo.listByGroup(userId, id, session),
          );
          const given = new Set(group.writeOffs.map(counterpartyKey));
          const fresh = [...open.keys()]
            .filter((key) => !given.has(key))
            .map((key) => writeOffOf(key, open));
          if (fresh.length === 0) {
            return Object.assign(
              await this.viewOf(
                userId,
                await this.repo.delete(id, session, expectedUpdatedAt),
              ),
              { restamped: [] },
            );
          }
          // The guard rides on the first write; the archive that follows is inside it.
          await this.repo.update(
            id,
            { writeOffs: [...group.writeOffs, ...fresh] },
            session,
            expectedUpdatedAt,
          );
          await this.stampWriteOff(
            userId,
            fresh,
            open,
            SHARED_HISTORY_REASONS.WRITE_OFF,
            session,
            journal,
          );
          return Object.assign(
            await this.viewOf(userId, await this.repo.delete(id, session)),
            {
              restamped: await this.ledger.restampsOf(userId, journal, session),
            },
          );
        }),
      () => this.repo.getOwnById(id, userId),
      (g) => new SharedGroup(g),
    );
  }

  /** Giving up on what one person, or one block of guests, still owes here. */
  async writeOff(
    id: string,
    dto: WriteOffDTO,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<WithRestamps<SharedGroupView>> {
    const group = await this.openGroup(id, userId, expectedUpdatedAt);
    const party = await this.writeOffParty(group, dto);
    const key = counterpartyKey(party);

    return guardedWrite(
      expectedUpdatedAt,
      () =>
        withTransaction(async (session) => {
          const journal = new RestampJournal();
          // Read again inside the write: two write-offs at once would overwrite each other.
          const fresh = await this.groupInSession(id, userId, session);
          this.assertOpen(fresh);
          if (fresh.writeOffs.some((one) => counterpartyKey(one) === key)) {
            return Object.assign(await this.viewOf(userId, fresh), {
              restamped: [],
            });
          }
          const open = openByParty(
            await this.expenseRepo.listByGroup(userId, id, session),
          );
          const entry = writeOffOf(key, open, party);
          const saved = await this.repo.update(
            id,
            { writeOffs: [...fresh.writeOffs, entry] },
            session,
            expectedUpdatedAt,
          );
          await this.stampWriteOff(
            userId,
            [entry],
            open,
            SHARED_HISTORY_REASONS.WRITE_OFF,
            session,
            journal,
          );
          return Object.assign(await this.viewOf(userId, saved), {
            restamped: await this.ledger.restampsOf(userId, journal, session),
          });
        }),
      () => this.repo.getOwnById(id, userId),
      (g) => new SharedGroup(g),
    );
  }

  /** Undone while the group is open, which is the only time it can be. */
  async undoWriteOff(
    id: string,
    partyId: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<WithRestamps<SharedGroupView>> {
    await this.openGroup(id, userId, expectedUpdatedAt);

    return guardedWrite(
      expectedUpdatedAt,
      () =>
        withTransaction(async (session) => {
          const journal = new RestampJournal();
          const fresh = await this.groupInSession(id, userId, session);
          this.assertOpen(fresh);
          // The stored entry already knows whether it is a person or a block of guests.
          const entry = fresh.writeOffs.find(
            (one) => one.contactId === partyId || one.expenseId === partyId,
          );
          if (!entry) {
            return Object.assign(await this.viewOf(userId, fresh), {
              restamped: [],
            });
          }
          const key = counterpartyKey(entry);
          const open = openByParty(
            await this.expenseRepo.listByGroup(userId, id, session),
          );
          const saved = await this.repo.update(
            id,
            {
              writeOffs: fresh.writeOffs.filter(
                (one) => counterpartyKey(one) !== key,
              ),
            },
            session,
            expectedUpdatedAt,
          );
          await this.stampWriteOff(
            userId,
            [entry],
            open,
            SHARED_HISTORY_REASONS.WRITE_OFF_UNDONE,
            session,
            journal,
          );
          return Object.assign(await this.viewOf(userId, saved), {
            restamped: await this.ledger.restampsOf(userId, journal, session),
          });
        }),
      () => this.repo.getOwnById(id, userId),
      (g) => new SharedGroup(g),
    );
  }

  // It moves no figure, and the history of every movement it touches says exactly that.
  private async stampWriteOff(
    userId: string,
    parties: { contactId: string | null; expenseId: string | null }[],
    open: Map<string, OpenAmount>,
    reason: SharedHistoryReason,
    session: TxSession,
    journal: RestampJournal,
  ): Promise<void> {
    const ids = new Set(
      parties.flatMap(
        (party) => open.get(counterpartyKey(party))?.expenseIds ?? [],
      ),
    );
    if (ids.size === 0) return;
    const movements = await this.transactionRepo.listBySharedExpenseIds(
      userId,
      [...ids],
      session,
    );
    for (const movement of movements) {
      await stampSharedChange(
        this.transactionRepo,
        session,
        movement,
        reason,
        journal,
      );
    }
  }

  private async groupInSession(
    id: string,
    userId: string,
    session: TxSession,
  ): Promise<SharedGroup> {
    const group = await this.repo.getByIdIncludingArchived(id, session);
    if (!group || group.userId !== userId) {
      throw new ApiError("NotFound", "Shared group not found");
    }
    return new SharedGroup(group);
  }

  private assertOpen(group: SharedGroup): void {
    if (group.archivedAt) {
      throw new ApiError(
        "BadRequest",
        "Shared group is archived; restore it first",
        "RESOURCE_ARCHIVED",
      );
    }
  }

  private async openGroup(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroup> {
    const group = await this.ownedGroup(id, userId);
    assertFresh(group, expectedUpdatedAt, (g) => new SharedGroup(g));
    this.assertOpen(group);
    return group;
  }

  private async viewOf(
    userId: string,
    group: SharedGroup,
  ): Promise<SharedGroupView> {
    const [view] = await this.withTotals(userId, [group]);
    return view as SharedGroupView;
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
    if (!dto.expenseId) {
      throw new ApiError(
        "BadRequest",
        "A write-off names one of them: contactId, or expenseId for its block of guests",
        "VALIDATION",
      );
    }
    const expense = await this.expenseRepo.getById(dto.expenseId);
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
    // A line somebody else fronted owes you nothing, so there is nothing of yours to give up.
    if (expense.paidByContactId !== null) {
      throw new ApiError(
        "BadRequest",
        "Somebody else fronted that line: its block of guests owes you nothing",
        "VALIDATION",
      );
    }
    return {
      kind: SETTLEMENT_PARTIES.GUESTS,
      contactId: null,
      expenseId: expense.id,
    };
  }

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
  ): Promise<
    WithRestamps<{ group: SharedGroupView; applied: AddParticipantsPreview }>
  > {
    const { group, plannedGroup, contactIds } = await this.plan(
      id,
      dto,
      userId,
    );
    assertFresh(group, expectedUpdatedAt, (g) => new SharedGroup(g));

    // Read and written in the same transaction: an expense added in between would keep the old split.
    const { updated, preview, restamped } = await guardedWrite(
      expectedUpdatedAt,
      () =>
        withTransaction(async (session) => {
          const journal = new RestampJournal();
          const plan = await this.simulate(
            plannedGroup,
            contactIds,
            dto.applyToExistingExpenses ?? false,
            session,
          );
          for (const expense of plan.resplit) {
            journal.note("sharedExpense", expense);
          }
          await this.expenseRepo.replaceSplits(plan.updates, session);
          await this.recordResplit(userId, plan.resplit, session, journal);
          const saved = await this.repo.update(
            id,
            {
              participants: plannedGroup.participants,
              defaultSplit: plannedGroup.defaultSplit,
            },
            session,
            expectedUpdatedAt,
          );
          return {
            updated: saved,
            preview: plan.preview,
            restamped: await this.ledger.restampsOf(userId, journal, session),
          };
        }),
      () => this.repo.getOwnById(id, userId),
      (g) => new SharedGroup(g),
    );
    const [view] = await this.withTotals(userId, [updated]);
    return { group: view as SharedGroupView, applied: preview, restamped };
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
    journal: RestampJournal,
  ): Promise<void> {
    if (expenses.length === 0) return;
    const { stamped } = await this.ledger.recompute(
      userId,
      expenses.flatMap(counterpartiesOf),
      SHARED_HISTORY_REASONS.SPLIT_EDITED,
      session,
      journal,
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
        journal,
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
        withTransaction(async (session) => {
          const written = await this.repo.update(
            id,
            {
              participants: group.participants.filter(
                (participant) => participant.contactId !== contactId,
              ),
              defaultSplit: rescaleDefaultSplit(group.defaultSplit, contactId),
              // Out of the group is out of it: coming back does not come back forgiven.
              writeOffs: group.writeOffs.filter(
                (one) => one.contactId !== contactId,
              ),
            },
            session,
            expectedUpdatedAt,
          );
          await this.invitationRepo.withdrawAll(
            {
              userId,
              groupId: id,
              contactId,
              statuses: [
                INVITATION_STATUSES.PENDING,
                INVITATION_STATUSES.ACCEPTED,
              ],
            },
            new Date(),
            session,
          );
          return written;
        }),
      () => this.repo.getOwnById(id, userId),
      (g) => new SharedGroup(g),
    );
    const [view] = await this.withTotals(userId, [updated]);
    return view as SharedGroupView;
  }
}
