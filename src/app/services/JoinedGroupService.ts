import {
  JoinedExpenseView,
  joinedExpenseView,
  JoinedGroupView,
  JoinedParticipantView,
  latest,
} from "../../domain/entities/JoinedGroup";
import { SharedInvitation } from "../../domain/entities/SharedInvitation";
import { Transaction } from "../../domain/entities/Transaction";
import { IContactRepository } from "../../domain/repositories/contact/IContactRepository";
import { ISharedExpenseRepository } from "../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import { ISharedGroupRepository } from "../../domain/repositories/sharedGroup/ISharedGroupRepository";
import { ISharedInvitationRepository } from "../../domain/repositories/sharedInvitation/ISharedInvitationRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import {
  createOrReplay,
  CreateOutcome,
  isDuplicateIdError,
} from "../../shared/clientMintedId";
import {
  INVITATION_STATUSES,
  SHARE_PARTIES,
  TRANSACTION_TYPES,
} from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import { toCents } from "../../shared/money";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import {
  ChangeCursor,
  compareChanges,
  isAfterCursor,
} from "../../shared/syncCursor";
import { TxSession, withTransaction } from "../../shared/unitOfWork";
import { TransactionService } from "./TransactionService";

export interface AddToLedgerDTO {
  id?: string;
  accountId: string;
  categoryId?: string | null;
}

export interface JoinedChanges {
  groups: JoinedGroupView[];
  expenses: JoinedExpenseView[];
}

const notFound = (): ApiError =>
  new ApiError("NotFound", "Shared group not found");

const notPaid = (message: string): ApiError =>
  new ApiError("BadRequest", message, "SHARED_LINE_NOT_PAID");

const inLedger = (): ApiError =>
  new ApiError(
    "BadRequest",
    "Your part of this line is already in your ledger",
    "SHARED_LINE_IN_LEDGER",
  );

const isDuplicateKey = (err: unknown): boolean =>
  (err as { code?: number }).code === 11000;

const joinedAt = (membership: SharedInvitation): Date =>
  membership.answeredAt ?? membership.updatedAt ?? new Date(0);

export class JoinedGroupService {
  constructor(
    private invitations: ISharedInvitationRepository,
    private groups: ISharedGroupRepository,
    private expenses: ISharedExpenseRepository,
    private contacts: IContactRepository,
    private users: IUserRepository,
    private transactions: ITransactionRepository,
    private transactionService: TransactionService,
  ) {}

  private async views(
    memberships: SharedInvitation[],
  ): Promise<JoinedGroupView[]> {
    const groupIds = memberships.map((m) => m.groupId);
    const groups = await this.groups.getManyIncludingArchived(groupIds);
    const ownerIds = [...new Set(groups.map((g) => g.userId))];
    const contactIds = groups.flatMap((g) =>
      g.participants.flatMap((p) => (p.contactId ? [p.contactId] : [])),
    );
    const [invitations, contacts] = await Promise.all([
      this.invitations.inGroups(ownerIds, groupIds),
      this.contacts.getManyIncludingArchived(contactIds),
    ]);
    const joined = invitations.filter(
      (inv) => inv.status === INVITATION_STATUSES.ACCEPTED && inv.inviteeId,
    );
    const users = await this.users.getManyByIds([
      ...ownerIds,
      ...joined.flatMap((inv) => (inv.inviteeId ? [inv.inviteeId] : [])),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const contactById = new Map(contacts.map((c) => [c.id, c]));
    const groupById = new Map(groups.map((g) => [g.id, g]));

    return memberships.flatMap((membership) => {
      const group = groupById.get(membership.groupId);
      const owner = group && userById.get(group.userId);
      if (!group || !owner) return [];
      const ofGroup = invitations.filter((inv) => inv.groupId === group.id);
      const joinedUser = new Map(
        joined
          .filter((inv) => inv.groupId === group.id)
          .map((inv) => [inv.contactId, userById.get(inv.inviteeId ?? "")]),
      );
      const touched: (Date | undefined)[] = [
        group.updatedAt,
        joinedAt(membership),
        ...ofGroup.map((inv) => inv.updatedAt),
      ];
      const participants = group.participants.map(
        ({ contactId }): JoinedParticipantView => {
          if (contactId === null) {
            return {
              contactId,
              name: owner.name,
              color: null,
              you: false,
              joined: true,
            };
          }
          const contact = contactById.get(contactId);
          const user = joinedUser.get(contactId);
          touched.push(contact?.updatedAt);
          return {
            contactId,
            name: user?.name ?? contact?.name ?? "",
            color: contact?.color ?? null,
            you: contactId === membership.contactId,
            joined: user !== undefined,
          };
        },
      );
      return [
        {
          id: group.id,
          invitationId: membership.id,
          name: group.name,
          color: group.color ?? null,
          currency: group.currency ?? membership.groupCurrency,
          ownerId: owner.id,
          ownerName: owner.name,
          participants,
          defaultSplit: group.defaultSplit,
          writeOffs: group.writeOffs,
          archivedAt: group.archivedAt,
          createdAt: group.createdAt,
          updatedAt: latest(touched),
        },
      ];
    });
  }

  private async membershipOf(
    groupId: string,
    userId: string,
    session?: TxSession,
  ): Promise<SharedInvitation> {
    const memberships = await this.invitations.memberships(userId, session);
    const membership = memberships.find((m) => m.groupId === groupId);
    if (!membership) throw notFound();
    return membership;
  }

  async list(
    userId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<JoinedGroupView>> {
    const page = await this.invitations.membershipsPage(userId, pagination);
    return { data: await this.views(page.data), pagination: page.pagination };
  }

  async get(groupId: string, userId: string): Promise<JoinedGroupView> {
    const [view] = await this.views([await this.membershipOf(groupId, userId)]);
    if (!view) throw notFound();
    return view;
  }

  async listExpenses(
    groupId: string,
    userId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<JoinedExpenseView>> {
    const membership = await this.membershipOf(groupId, userId);
    const since = joinedAt(membership);
    const page = await this.expenses.getAllByGroup(
      membership.userId,
      groupId,
      pagination,
    );
    return {
      data: page.data.map((expense) => joinedExpenseView(expense, since)),
      pagination: page.pagination,
    };
  }

  // A row sits where it changed or where you joined, whichever is later, so a late join arrives whole.
  async changes(
    userId: string,
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<JoinedChanges> {
    const memberships = await this.invitations.memberships(userId);
    if (memberships.length === 0) return { groups: [], expenses: [] };

    const onCursor = (at: Date): boolean =>
      cursor !== undefined && at.getTime() === cursor.updatedAt.getTime();
    const fresh = memberships.filter((m) => {
      const at = joinedAt(m);
      if (!cursor || at.getTime() > cursor.updatedAt.getTime()) return true;
      return onCursor(at) && cursor.id !== null;
    });
    const sinceOf = new Map(memberships.map((m) => [m.groupId, joinedAt(m)]));
    const [views, recent, ...atJoin] = await Promise.all([
      this.views(memberships),
      this.expenses.changesInGroups(
        memberships.map((m) => ({
          groupId: m.groupId,
          after: fresh.includes(m) ? joinedAt(m) : null,
        })),
        cursor,
        limit,
      ),
      ...fresh.map((m) =>
        this.expenses.atJoin(
          m.groupId,
          joinedAt(m),
          onCursor(joinedAt(m)) ? (cursor?.id ?? null) : null,
          limit,
        ),
      ),
    ]);
    const firstOf = <T extends { id: string; updatedAt: Date }>(
      rows: T[],
    ): T[] =>
      rows
        .filter((row) => isAfterCursor(row, cursor))
        .sort(compareChanges)
        .slice(0, limit);
    return {
      groups: firstOf(views),
      expenses: firstOf(
        [...recent, ...atJoin.flat()].map((expense) =>
          joinedExpenseView(
            expense,
            sinceOf.get(expense.groupId) ?? new Date(0),
          ),
        ),
      ),
    };
  }

  async addToLedger(
    groupId: string,
    expenseId: string,
    dto: AddToLedgerDTO,
    userId: string,
    timezone: string,
    outcome?: CreateOutcome,
  ): Promise<Transaction> {
    return createOrReplay({
      clientId: dto.id,
      outcome,
      findOwn: (id) => this.transactions.getOwnById(id, userId),
      replay: async (t) => t,
      create: () => this.recordShare(groupId, expenseId, dto, userId, timezone),
    });
  }

  private async recordShare(
    groupId: string,
    expenseId: string,
    dto: AddToLedgerDTO,
    userId: string,
    timezone: string,
  ): Promise<Transaction> {
    try {
      return await withTransaction(async (session) => {
        const membership = await this.membershipOf(groupId, userId, session);
        const expense = await this.expenses.getById(expenseId, session);
        if (!expense || expense.groupId !== groupId) {
          throw new ApiError("NotFound", "Shared expense not found");
        }
        if (expense.paidByContactId !== null) {
          throw notPaid(
            "Only a line the person who shared the group paid can be added from here",
          );
        }
        const share = expense.split.shares.find(
          (s) =>
            s.party === SHARE_PARTIES.CONTACT &&
            s.contactId === membership.contactId,
        );
        if (!share || toCents(share.amount) <= 0) {
          throw notPaid("You have no part in this line");
        }
        if (toCents(share.collected) < toCents(share.amount)) {
          throw notPaid("Your part of this line is not marked paid yet");
        }
        if (await this.transactions.getImported(userId, expenseId, session)) {
          throw inLedger();
        }
        return this.transactionService.recordWithin(
          {
            id: dto.id,
            type: TRANSACTION_TYPES.EXPENSE,
            amount: share.amount,
            date: expense.date,
            description: expense.description,
            categoryId: dto.categoryId ?? null,
            fromAccountId: dto.accountId,
            userId,
            currency: expense.currency,
            importedFromGroupId: groupId,
            importedFromExpenseId: expenseId,
          },
          timezone,
          session,
        );
      });
    } catch (err) {
      // Two devices adding the same line meet in the partial unique index, not in the read above.
      if (isDuplicateKey(err) && !isDuplicateIdError(err)) throw inLedger();
      throw err;
    }
  }
}
