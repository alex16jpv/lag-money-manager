import {
  ITransactionRepository,
  SpendingBucket,
  SpendingGroupBy,
  SpendingQuery,
  SpendingSplitBy,
} from "../../domain/repositories/transaction/ITransactionRepository";
import { fromCents } from "../../shared/money";

export interface SpendingReport {
  groupBy: SpendingGroupBy;
  splitBy: SpendingSplitBy | null;
  buckets: SpendingBucket[];
  total: number;
}

export class StatsService {
  constructor(private transactionRepo: ITransactionRepository) {}

  async getSpending(
    userId: string,
    query: SpendingQuery,
  ): Promise<SpendingReport> {
    const { buckets, totalCents } =
      await this.transactionRepo.aggregateSpending(userId, query);
    return {
      groupBy: query.groupBy,
      splitBy: query.splitBy ?? null,
      buckets,
      total: fromCents(totalCents),
    };
  }
}
