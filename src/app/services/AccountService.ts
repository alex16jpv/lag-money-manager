import { Account } from "../../domain/entities/Account";
import {
  AccountFilters,
  IAccountRepository,
} from "../../domain/repositories/account/IAccountRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { createOrReplay, CreateOutcome } from "../../shared/clientMintedId";
import { assertFresh, guardedWrite } from "../../shared/concurrency";
import {
  AccountType,
  DEBT_ACCOUNT_FIELD_NAMES,
  DEBT_ACCOUNT_FIELDS,
  DebtAccountField,
} from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";
import { ApiError } from "../../shared/errors";
import { assertAmountPrecision } from "../../shared/money";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { CreateAccountDTO, UpdateAccountDTO } from "../dtos/AccountDTO";

// Soft cap: protects the shared Atlas M0 tier from runaway creation.
const MAX_ACCOUNTS_PER_USER = 100;

const afterWrite = (
  sent: number | null | undefined,
  stored?: number,
): number | null | undefined => (sent === undefined ? stored : sent);

// T-93: the state a loan cannot be read in, closed here too, or a movement could never be edited out of it.
function assertLoanNotInCredit(type: AccountType, balance: number): void {
  if (type !== "LOAN" || balance <= 0) return;
  throw new ApiError(
    "BadRequest",
    "A loan cannot hold money of its own: its balance is what is still owed",
    "LOAN_OVERPAID",
    [{ field: "balance", message: "A loan cannot be above zero" }],
  );
}

export class AccountService {
  constructor(
    private repo: IAccountRepository,
    private userRepo: IUserRepository,
  ) {}

  async getAllAccounts(
    userId: string,
    pagination: PaginationParams,
    filters?: AccountFilters,
  ): Promise<PaginatedResult<Account>> {
    return this.repo.getAllByUserId(userId, pagination, filters);
  }

  // Reads resolve archived accounts too; only the listing hides them by default.
  async getAccountById(id: string, userId: string): Promise<Account> {
    const account = await this.repo.getByIdIncludingArchived(id);
    if (!account || account.userId !== userId) {
      throw new ApiError("NotFound", "Account not found");
    }
    return new Account(account);
  }

  // The two lookups that tell a taken name and an archived reference from a missing row (/sync §5).
  async findActiveByName(
    userId: string,
    name: string,
  ): Promise<Account | null> {
    const account = await this.repo.findActiveByName(userId, name);
    return account && new Account(account);
  }

  async findOwnAccount(id: string, userId: string): Promise<Account | null> {
    const account = await this.repo.getOwnById(id, userId);
    return account && new Account(account);
  }

  async createAccount(
    dto: CreateAccountDTO,
    outcome?: CreateOutcome,
  ): Promise<Account> {
    return createOrReplay({
      clientId: dto.id,
      outcome,
      findOwn: (id) => this.repo.getOwnById(id, dto.userId),
      replay: async (a) => new Account(a),
      create: () => this.insertAccount(dto),
    });
  }

  private async insertAccount(dto: CreateAccountDTO): Promise<Account> {
    const count = await this.repo.countByUserId(dto.userId);
    if (count >= MAX_ACCOUNTS_PER_USER) {
      throw new ApiError(
        "BadRequest",
        `Account limit reached (${MAX_ACCOUNTS_PER_USER})`,
        "ACCOUNT_LIMIT_REACHED",
      );
    }
    // Mono-currency: the currency is only editable with no accounts, so this read is exact.
    const owner = await this.userRepo.getById(dto.userId);
    const currency = owner?.currency ?? DEFAULT_CURRENCY;
    assertAmountPrecision(dto.balance, currency, "balance");
    this.assertDebtFields(dto.type, dto, currency);
    assertLoanNotInCredit(dto.type, dto.balance);
    const account = new Account({
      ...dto,
      isDefault: count === 0,
      currency,
    });
    return new Account(await this.repo.create(account));
  }

  async setDefaultAccount(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<Account> {
    const account = await this.repo.setDefault(id, userId, expectedUpdatedAt);
    if (account) {
      return account;
    }
    // null also means archived or missing, which stay 404 as before.
    const current = await this.repo.getOwnById(id, userId);
    if (current) {
      assertFresh(current, expectedUpdatedAt, (a) => new Account(a));
    }
    throw new ApiError("NotFound", "Account not found");
  }

  async updateAccount(
    id: string,
    dto: UpdateAccountDTO,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<Account> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Account id does not match");
    }

    const existing = await this.repo.getByIdIncludingArchived(id);
    if (!existing || existing.userId !== userId) {
      throw new ApiError("NotFound", "Account not found");
    }
    // Before the archived check: an old-version caller needs to re-read, not a reason it cannot know.
    assertFresh(existing, expectedUpdatedAt, (a) => new Account(a));
    if (existing.archivedAt) {
      throw new ApiError(
        "BadRequest",
        "Account is archived; restore it first",
        "RESOURCE_ARCHIVED",
      );
    }

    // Only the fields this write touches: a rename cannot fix a pairing it did not create.
    const judged = (field: DebtAccountField): number | null | undefined =>
      dto.type === undefined && dto[field] === undefined
        ? undefined
        : afterWrite(dto[field], existing[field]);
    const currency = existing.currency ?? DEFAULT_CURRENCY;
    this.assertDebtFields(
      dto.type ?? existing.type,
      {
        creditLimit: judged("creditLimit"),
        borrowedAmount: judged("borrowedAmount"),
      },
      currency,
      // T-67: the pairing is judged on what the row will hold, the precision only on what was sent.
      dto,
    );
    assertLoanNotInCredit(dto.type ?? existing.type, existing.balance);

    // A write that leans on what the guard read carries that version into its own filter.
    const guard =
      expectedUpdatedAt ??
      (dto.type !== undefined ||
      DEBT_ACCOUNT_FIELD_NAMES.some((field) => dto[field] !== undefined)
        ? existing.updatedAt
        : undefined);

    return guardedWrite(
      guard,
      async () =>
        new Account(await this.repo.update(id, dto, undefined, guard)),
      () => this.repo.getOwnById(id, userId),
      (a) => new Account(a),
    );
  }

  private assertDebtFields(
    type: AccountType,
    amounts: { creditLimit?: number | null; borrowedAmount?: number | null },
    currency: string,
    written: {
      creditLimit?: number | null;
      borrowedAmount?: number | null;
    } = amounts,
  ): void {
    for (const field of DEBT_ACCOUNT_FIELD_NAMES) {
      const amount = amounts[field];
      if (amount === undefined || amount === null) {
        continue;
      }
      const types: readonly AccountType[] = DEBT_ACCOUNT_FIELDS[field];
      if (!types.includes(type)) {
        throw new ApiError(
          "BadRequest",
          `${field} is only valid on ${types.join(" and ")} accounts`,
          "ACCOUNT_FIELD_NOT_FOR_TYPE",
          [{ field, message: `A ${type} account has no ${field}` }],
        );
      }
      const sent = written[field];
      if (sent !== undefined && sent !== null) {
        assertAmountPrecision(sent, currency, field);
      }
    }
  }

  // F-22: idempotent, and it answers the archived row so a queued restore can guard on its updatedAt.
  async deleteAccount(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<Account> {
    const existing = await this.repo.getByIdIncludingArchived(id);
    if (!existing || existing.userId !== userId) {
      throw new ApiError("NotFound", "Account not found");
    }
    assertFresh(existing, expectedUpdatedAt, (a) => new Account(a));
    if (existing.archivedAt) {
      return new Account(existing);
    }
    if (existing.isDefault) {
      throw new ApiError(
        "BadRequest",
        "Cannot archive the default account; set another account as default first",
        "DEFAULT_ACCOUNT_ARCHIVE_BLOCKED",
      );
    }

    const archived = await this.repo.archiveNonDefault(
      id,
      userId,
      expectedUpdatedAt,
    );
    if (archived) {
      return new Account(archived);
    }
    // Raced with setDefault or another archive since the check above.
    const current = await this.repo.getByIdIncludingArchived(id);
    if (!current || current.userId !== userId) {
      throw new ApiError("NotFound", "Account not found");
    }
    assertFresh(current, expectedUpdatedAt, (a) => new Account(a));
    if (current.archivedAt) {
      return new Account(current); // lost the race to another archive: idempotent success
    }
    throw new ApiError(
      "BadRequest",
      "Cannot archive the default account; set another account as default first",
      "DEFAULT_ACCOUNT_ARCHIVE_BLOCKED",
    );
  }

  // Idempotent: restoring an already-active account returns it unchanged.
  async restoreAccount(
    id: string,
    userId: string,
    name?: string,
    expectedUpdatedAt?: Date,
  ): Promise<Account> {
    const restored = await this.repo.restore(
      id,
      userId,
      name,
      expectedUpdatedAt,
    );
    if (restored) {
      return new Account(restored);
    }
    const current = await this.repo.getByIdIncludingArchived(id);
    if (!current || current.userId !== userId) {
      throw new ApiError("NotFound", "Account not found");
    }
    assertFresh(current, expectedUpdatedAt, (a) => new Account(a));
    return new Account(current);
  }
}
