import { ApiError } from "../../shared/errors";
import {
  compareChanges,
  decodeCursor,
  encodeCursor,
  isAfterCursor,
} from "../../shared/syncCursor";

const at = (iso: string): Date => new Date(iso);

describe("sync cursor", () => {
  it("round-trips a position inside an instant", () => {
    const cursor = { updatedAt: at("2026-09-03T12:00:00.000Z"), id: "abc" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("round-trips a bare instant", () => {
    const cursor = { updatedAt: at("2026-09-03T12:00:00.000Z"), id: null };
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

  // Serving page one for an unreadable cursor is what made infinite scroll
  // duplicate items in the listings; the feed must not repeat that.
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

    // A bare instant means "strictly after it", so a row stamped exactly then
    // is excluded whatever its id.
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
});
