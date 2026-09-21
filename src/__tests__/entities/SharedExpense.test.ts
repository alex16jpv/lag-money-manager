import { SharedExpense } from "../../domain/entities/SharedExpense";

const userId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const groupId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac71";

const split = (): SharedExpense["split"] => ({
  mode: "EQUAL",
  guests: null,
  shares: [
    {
      party: "USER",
      contactId: null,
      percent: null,
      fixedAmount: null,
      amount: 90000,
    },
  ],
});

describe("SharedExpense Entity", () => {
  const make = (props: Partial<SharedExpense> = {}): SharedExpense =>
    new SharedExpense({
      groupId,
      date: new Date("2026-09-15T12:00:00.000Z"),
      amount: 90000,
      split: split(),
      userId,
      ...props,
    });

  it("defaults to the user having paid, no description and no custom split", () => {
    const expense = make();

    expect(expense.paidByContactId).toBeNull();
    expect(expense.description).toBeNull();
    expect(expense.customSplit).toBe(false);
    expect(expense.deletedAt).toBeNull();
  });

  describe("assertValid", () => {
    it("accepts an ordinary expense", () => {
      expect(() => make().assertValid()).not.toThrow();
    });

    it("refuses an amount of zero", () => {
      expect(() => make({ amount: 0 }).assertValid()).toThrow("greater than 0");
    });

    it("refuses a negative amount", () => {
      expect(() => make({ amount: -1 }).assertValid()).toThrow(
        "greater than 0",
      );
    });

    it("refuses a date more than a day ahead", () => {
      const expense = make({
        date: new Date(Date.now() + 48 * 60 * 60 * 1000),
      });

      expect(() => expense.assertValid()).toThrow(
        expect.objectContaining({ code: "FUTURE_DATE" }),
      );
    });

    it("takes a date inside the day's window, as a transaction does", () => {
      const expense = make({ date: new Date(Date.now() + 60 * 60 * 1000) });

      expect(() => expense.assertValid()).not.toThrow();
    });
  });
});
