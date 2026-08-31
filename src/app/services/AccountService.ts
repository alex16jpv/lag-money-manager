import { Account } from "../../domain/entities/Account";
import { AccountFilters, IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { DEFAULT_CURRENCY } from "../../shared/currency";
import { ApiError } from "../../shared/errors";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { CreateAccountDTO, UpdateAccountDTO } from "../dtos/AccountDTO";

// Soft cap: protects the shared Atlas M0 tier from runaway creation.
const MAX_ACCOUNTS_PER_USER = 100;

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

  // Reads resolve archived accounts too (archivedAt tells them apart);
  // only the listing hides them by default.
  async getAccountById(id: string, userId: string): Promise<Account> {
    const account = await this.repo.getByIdIncludingArchived(id);
    if (!account || account.userId !== userId) {
      throw new ApiError("NotFound", "Account not found");
    }
    return new Account(account);
  }

  async createAccount(dto: CreateAccountDTO): Promise<Account> {
    const count = await this.repo.countByUserId(dto.userId);
    if (count >= MAX_ACCOUNTS_PER_USER) {
      throw new ApiError(
        "BadRequest",
        `Account limit reached (${MAX_ACCOUNTS_PER_USER})`,
        "ACCOUNT_LIMIT_REACHED",
      );
    }
    // Mono-currency mode: stamped from the owner (fresh read — the currency
    // is only editable while the user has no accounts, so this is exact).
    const owner = await this.userRepo.getById(dto.userId);
    const account = new Account({
      ...dto,
      isDefault: count === 0,
      currency: owner?.currency ?? DEFAULT_CURRENCY,
    });
    return new Account(await this.repo.create(account));
  }

  async setDefaultAccount(id: string, userId: string): Promise<Account> {
    const account = await this.repo.setDefault(id, userId);
    if (!account) {
      throw new ApiError("NotFound", "Account not found");
    }
    return account;
  }

  async updateAccount(
    id: string,
    dto: UpdateAccountDTO,
    userId: string,
  ): Promise<Account> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Account id does not match");
    }

    const existing = await this.repo.getByIdIncludingArchived(id);
    if (!existing || existing.userId !== userId) {
      throw new ApiError("NotFound", "Account not found");
    }
    if (existing.archivedAt) {
      throw new ApiError(
        "BadRequest",
        "Account is archived; restore it first",
        "RESOURCE_ARCHIVED",
      );
    }

    return new Account(await this.repo.update(id, dto));
  }

  // Archive (soft delete); allowed even with linked transactions.
  // Idempotent: archiving an already-archived account is a no-op success.
  async deleteAccount(id: string, userId: string): Promise<void> {
    const existing = await this.repo.getByIdIncludingArchived(id);
    if (!existing || existing.userId !== userId) {
      throw new ApiError("NotFound", "Account not found");
    }
    if (existing.archivedAt) {
      return;
    }
    if (existing.isDefault) {
      throw new ApiError(
        "BadRequest",
        "Cannot archive the default account; set another account as default first",
        "DEFAULT_ACCOUNT_ARCHIVE_BLOCKED",
      );
    }

    const archived = await this.repo.archiveNonDefault(id, userId);
    if (!archived) {
      // Raced with setDefault or another archive since the check above.
      const current = await this.repo.getByIdIncludingArchived(id);
      if (!current || current.userId !== userId) {
        throw new ApiError("NotFound", "Account not found");
      }
      if (current.archivedAt) {
        return; // lost the race to another archive: idempotent success
      }
      throw new ApiError(
        "BadRequest",
        "Cannot archive the default account; set another account as default first",
        "DEFAULT_ACCOUNT_ARCHIVE_BLOCKED",
      );
    }
  }

  // Idempotent: restoring an already-active account returns it unchanged.
  async restoreAccount(id: string, userId: string): Promise<Account> {
    const restored = await this.repo.restore(id, userId);
    if (restored) {
      return new Account(restored);
    }
    const current = await this.repo.getByIdIncludingArchived(id);
    if (!current || current.userId !== userId) {
      throw new ApiError("NotFound", "Account not found");
    }
    return new Account(current);
  }
}
