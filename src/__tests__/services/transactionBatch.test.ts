jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: { NODE_ENV: "test" },
  TRANSACTION_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
    ADJUSTMENT: "ADJUSTMENT",
  },
  TRANSACTION_SOURCES: { MANUAL: "MANUAL", QUICK: "QUICK", IMPORT: "IMPORT" },
  CATEGORY_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
  },
  MODEL_NAMES: { TRANSACTION: "Transaction" },
}));

import { DomainValidationError } from "../../domain/errors";
import { ApiError } from "../../shared/errors";
import { TransactionService } from "../../app/services/TransactionService";

const service = new TransactionService(
  {} as never,
  {} as never,
  {} as never,
  {} as never,
);

const item = (id: string) => ({ id, description: "detail" });

// Each item stands alone (the owner's decision): one failure must not cost the
// others their save, and the response has to say which is which.
describe("batchUpdateDetails", () => {
  it("saves the items that work and reports the ones that do not", async () => {
    jest
      .spyOn(service, "updateTransaction")
      .mockResolvedValueOnce({ id: "a" } as never)
      .mockRejectedValueOnce(new ApiError("NotFound", "Transaction not found"))
      .mockResolvedValueOnce({ id: "c" } as never);

    const result = await service.batchUpdateDetails(
      [item("a"), item("b"), item("c")],
      "u1",
    );

    expect(result.updated.map((t) => t.id)).toEqual(["a", "c"]);
    expect(result.failed).toEqual([
      { id: "b", code: "NOT_FOUND", message: "Transaction not found" },
    ]);
  });

  it("keeps the code of a domain rejection so the client can branch on it", async () => {
    jest
      .spyOn(service, "updateTransaction")
      .mockRejectedValueOnce(
        new DomainValidationError(
          "archived",
          "categoryId",
          "CATEGORY_ARCHIVED",
        ),
      );

    const { failed } = await service.batchUpdateDetails([item("a")], "u1");

    expect(failed[0].code).toBe("CATEGORY_ARCHIVED");
  });

  it("carries the code of an ApiError that has one", async () => {
    jest
      .spyOn(service, "updateTransaction")
      .mockRejectedValueOnce(
        new ApiError("BadRequest", "archived", "RESOURCE_ARCHIVED"),
      );

    const { failed } = await service.batchUpdateDetails([item("a")], "u1");

    expect(failed[0].code).toBe("RESOURCE_ARCHIVED");
  });

  // A database outage is not "this item failed": swallowing it would report a
  // partial success that never happened.
  it("lets a real fault surface instead of reporting it as one bad item", async () => {
    jest
      .spyOn(service, "updateTransaction")
      .mockRejectedValueOnce(new Error("connection lost"));

    await expect(service.batchUpdateDetails([item("a")], "u1")).rejects.toThrow(
      "connection lost",
    );
  });

  it("stops nothing when every item works", async () => {
    jest
      .spyOn(service, "updateTransaction")
      .mockResolvedValue({ id: "x" } as never);

    const { updated, failed } = await service.batchUpdateDetails(
      [item("a"), item("b")],
      "u1",
    );

    expect(updated).toHaveLength(2);
    expect(failed).toEqual([]);
  });
});
