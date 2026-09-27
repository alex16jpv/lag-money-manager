import { ApiError } from "../../shared/errors";
import {
  compareChanges,
  cursorFitsReset,
  decodeCursor,
  encodeCursor,
  isAfterCursor,
} from "../../shared/syncCursor";

const at = (iso: string): Date => new Date(iso);

describe("sync cursor", () => {
  it("round-trips a position inside an instant", () => {
    const cursor = { updatedAt: at("2026-09-03T12:00:00.000Z"), id: "abc" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual({
      ...cursor,
      resetAt: null,
    });
  });

  it("round-trips a bare instant", () => {
    const cursor = { updatedAt: at("2026-09-03T12:00:00.000Z"), id: null };
    expect(decodeCursor(encodeCursor(cursor))).toEqual({
      ...cursor,
      resetAt: null,
    });
  });

  it("keeps the v1 format for an account that was never reset", () => {
    const encoded = encodeCursor({
      updatedAt: at("2026-09-03T12:00:00.000Z"),
      id: "abc",
      resetAt: null,
    });
    expect(Buffer.from(encoded, "base64url").toString("utf8")).toBe(
      "v1|2026-09-03T12:00:00.000Z|abc",
    );
  });

  it("round-trips the reset a cursor was issued under [T-207]", () => {
    const cursor = {
      updatedAt: at("2026-09-03T12:00:00.000Z"),
      id: "abc",
      resetAt: at("2026-09-02T08:00:00.000Z"),
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("is opaque: nothing readable leaks into the URL", () => {
    const encoded = encodeCursor({
      updatedAt: at("2026-09-03T12:00:00.000Z"),
      id: "abc",
    });
    expect(encoded).not.toContain("2026");
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  // Serving page one for an unreadable cursor is what made infinite scroll duplicate rows.
  it.each([
    ["not base64 at all", "!!!!"],
    ["a plain id", "019576a0-d7b6-7d6d-af6a-2b7545f5ac71"],
    [
      "an unknown version",
      Buffer.from("v9|2026-09-03T12:00:00.000Z|x").toString("base64url"),
    ],
    [
      "an unparseable date",
      Buffer.from("v1|not-a-date|x").toString("base64url"),
    ],
    [
      "too few fields",
      Buffer.from("v1|2026-09-03T12:00:00.000Z").toString("base64url"),
    ],
    [
      "a v2 without its reset",
      Buffer.from("v2|2026-09-03T12:00:00.000Z|x").toString("base64url"),
    ],
    [
      "a v2 whose reset is not a date",
      Buffer.from("v2|2026-09-03T12:00:00.000Z|x|soon").toString("base64url"),
    ],
  ])("rejects %s with 400 INVALID_CURSOR", (_label, raw) => {
    expect(() => decodeCursor(raw)).toThrow(ApiError);
    try {
      decodeCursor(raw);
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(400);
      expect((err as ApiError).code).toBe("INVALID_CURSOR");
    }
  });

  describe("ordering", () => {
    it("orders by updatedAt, then by id", () => {
      const rows = [
        { id: "b", updatedAt: at("2026-01-02T00:00:00.000Z") },
        { id: "c", updatedAt: at("2026-01-01T00:00:00.000Z") },
        { id: "a", updatedAt: at("2026-01-01T00:00:00.000Z") },
      ];
      expect([...rows].sort(compareChanges).map((r) => r.id)).toEqual([
        "a",
        "c",
        "b",
      ]);
    });

    it("treats identical positions as equal", () => {
      const key = { id: "a", updatedAt: at("2026-01-01T00:00:00.000Z") };
      expect(compareChanges(key, { ...key })).toBe(0);
    });
  });

  describe("isAfterCursor", () => {
    const cursor = { updatedAt: at("2026-01-01T00:00:00.000Z"), id: "m" };

    it("keeps everything when there is no cursor (snapshot)", () => {
      expect(isAfterCursor({ id: "a", updatedAt: at("1999-01-01") })).toBe(
        true,
      );
    });

    it("breaks a tie on the id", () => {
      expect(
        isAfterCursor({ id: "n", updatedAt: cursor.updatedAt }, cursor),
      ).toBe(true);
      expect(
        isAfterCursor({ id: "m", updatedAt: cursor.updatedAt }, cursor),
      ).toBe(false);
      expect(
        isAfterCursor({ id: "l", updatedAt: cursor.updatedAt }, cursor),
      ).toBe(false);
    });

    // A bare instant means strictly after it, so a row stamped exactly then is excluded.
    it("excludes the whole instant when the cursor has no id", () => {
      const bare = { updatedAt: at("2026-01-01T00:00:00.000Z"), id: null };
      expect(isAfterCursor({ id: "z", updatedAt: bare.updatedAt }, bare)).toBe(
        false,
      );
      expect(
        isAfterCursor(
          { id: "a", updatedAt: at("2026-01-01T00:00:00.001Z") },
          bare,
        ),
      ).toBe(true);
    });
  });

  describe("cursorFitsReset [T-207]", () => {
    const reset = at("2026-09-02T08:00:00.000Z");

    it("takes any cursor of an account that was never reset", () => {
      expect(
        cursorFitsReset(
          {
            updatedAt: at("2020-01-01T00:00:00.000Z"),
            id: null,
            resetAt: null,
          },
          null,
        ),
      ).toBe(true);
    });

    it("refuses a cursor issued before the account's reset", () => {
      expect(
        cursorFitsReset(
          { updatedAt: at("2026-09-03T00:00:00.000Z"), id: "x", resetAt: null },
          reset,
        ),
      ).toBe(false);
    });

    it("refuses a cursor issued under an earlier reset", () => {
      expect(
        cursorFitsReset(
          {
            updatedAt: at("2026-09-03T00:00:00.000Z"),
            id: "x",
            resetAt: at("2026-08-01T00:00:00.000Z"),
          },
          reset,
        ),
      ).toBe(false);
    });

    it("takes a cursor issued under the current reset, whatever row it points at", () => {
      expect(
        cursorFitsReset(
          {
            updatedAt: at("2025-01-01T00:00:00.000Z"),
            id: "old-invitation",
            resetAt: reset,
          },
          reset,
        ),
      ).toBe(true);
    });

    it("takes a since that starts after the reset, and refuses one from before", () => {
      expect(
        cursorFitsReset(
          { updatedAt: at("2026-09-02T09:00:00.000Z"), id: null },
          reset,
        ),
      ).toBe(true);
      expect(
        cursorFitsReset(
          { updatedAt: at("2026-09-01T09:00:00.000Z"), id: null },
          reset,
        ),
      ).toBe(false);
      expect(
        cursorFitsReset(
          { updatedAt: at("2026-09-01T09:00:00.000Z"), id: null },
          null,
        ),
      ).toBe(true);
    });
  });
});
