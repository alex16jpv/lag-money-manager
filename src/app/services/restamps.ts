import { ApiError } from "../../shared/errors";
import { RestampedEntity } from "../../shared/syncBatch";

// Nothing but this write moved the row from `previousUpdatedAt` to `updatedAt`.
export interface Restamp {
  entity: RestampedEntity;
  id: string;
  previousUpdatedAt: Date;
  updatedAt: Date;
}

export type WithRestamps<T> = T & { restamped: Restamp[] };

interface Before {
  entity: RestampedEntity;
  id: string;
  updatedAt: Date;
}

// One per database transaction, so a retried attempt starts from nothing.
export class RestampJournal {
  private readonly before = new Map<string, Before>();

  // The first stamp wins: a later read inside the same transaction already sees this write.
  note(entity: RestampedEntity, row: { id: string; updatedAt?: Date }): void {
    const key = `${entity}:${row.id}`;
    if (this.before.has(key)) return;
    if (row.updatedAt === undefined) {
      throw new ApiError(
        "InternalServerError",
        `A ${entity} this write rewrites was read without its updatedAt`,
      );
    }
    this.before.set(key, { entity, id: row.id, updatedAt: row.updatedAt });
  }

  idsOf(entity: RestampedEntity): string[] {
    return [...this.before.values()]
      .filter((row) => row.entity === entity)
      .map((row) => row.id);
  }

  entries(): Before[] {
    return [...this.before.values()];
  }
}
