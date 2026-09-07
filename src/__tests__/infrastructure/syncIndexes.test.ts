// The real models are loaded, not mocks: the point is the index list Mongoose
// would actually sync. They only need the environment to parse.
process.env.JWT_SECRET ??= "sync-indexes-test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.MONGO_URI ??= "mongodb://localhost:27017/unused";

import { Schema } from "mongoose";

import { AccountModel } from "../../infrastructure/models/AccountModel";
import { BudgetModel } from "../../infrastructure/models/BudgetModel";
import { CategoryModel } from "../../infrastructure/models/CategoryModel";
import { TransactionModel } from "../../infrastructure/models/TransactionModel";

type IndexSpec = [Record<string, number>, Record<string, unknown>?];

// Without this index the change feed sorts every one of the user's documents
// in memory on every pull, and the suite mocks the repositories — nothing else
// here would notice it disappearing.
describe("change feed indexes", () => {
  it.each([
    ["account", AccountModel.schema],
    ["category", CategoryModel.schema],
    ["transaction", TransactionModel.schema],
    ["budget", BudgetModel.schema],
  ])("%s is keyset-scannable by (userId, updatedAt, _id)", (_name, schema) => {
    const declared = (schema as Schema).indexes() as IndexSpec[];
    const found = declared.find(
      ([keys]) =>
        JSON.stringify(keys) ===
        JSON.stringify({ userId: 1, updatedAt: 1, _id: 1 }),
    );
    expect(found).toBeDefined();
    // A partial filter would drop exactly the rows the feed exists to report.
    expect(found?.[1]?.partialFilterExpression).toBeUndefined();
  });
});
