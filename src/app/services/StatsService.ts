import {
  ITransactionRepository,
  SpendingBucket,
  SpendingQuery,
} from "../../domain/repositories/transaction/ITransactionRepository";
import { fromCents } from "../../shared/money";

export class StatsService {
  constructor(private transactionRepo: ITransactionRepository) {}

  async getSpending(
    userId: string,
    query: SpendingQuery,
  ): Promise<{ groupBy: string; buckets: SpendingBucket[]; total: number }> {
    const { buckets, totalCents } =
      await this.transactionRepo.aggregateSpending(userId, query);
    return { groupBy: query.groupBy, buckets, total: fromCents(totalCents) };
  }
}
