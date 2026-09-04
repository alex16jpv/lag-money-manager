import {
  CHANGE_FEED_SORT,
  changesSinceFilter,
} from "../../infrastructure/repositories/changeFeed";

const USER = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const t = new Date("2026-09-03T12:00:00.000Z");

describe("changesSinceFilter", () => {
  it("scopes a snapshot to the owner and nothing else", () => {
    expect(changesSinceFilter(USER, undefined)).toEqual({ userId: USER });
  });

  it("reads a bare instant as strictly after it", () => {
    expect(changesSinceFilter(USER, { updatedAt: t, id: null })).toEqual({
      userId: USER,
      updatedAt: { $gt: t },
    });
  });

  // Both branches keep userId as their prefix so each is answered by
  // (userId, updatedAt, _id) already sorted, instead of a blocking sort.
  it("keeps every $or branch owner-prefixed", () => {
    const filter = changesSinceFilter(USER, { updatedAt: t, id: "abc" });

    expect(filter.userId).toBe(USER);
    expect(filter.$or).toEqual([
      { updatedAt: { $gt: t } },
      { updatedAt: t, _id: { $gt: "abc" } },
    ]);
  });

  it("sorts the way the index is laid out", () => {
    expect(CHANGE_FEED_SORT).toEqual({ updatedAt: 1, _id: 1 });
  });
});
