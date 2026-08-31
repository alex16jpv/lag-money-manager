import {
  ITransactionRepository,
  SpendingBucket,
  SpendingQuery,
} from "../../domain/repositories/transaction/ITransactionRepository";

export class StatsService {
  constructor(private transactionRepo: ITransactionRepository) {}

  async getSpending(
    userId: string,
    query: SpendingQuery,
  ): Promise<{ groupBy: string; buckets: SpendingBucket[]; total: number }> {
    const buckets = await this.transactionRepo.aggregateSpending(userId, query);
    const total = buckets.reduce((sum, b) => sum + b.total, 0);
    return { groupBy: query.groupBy, buckets, total };
  }
}
