import {
  assertFresh,
  guardedWrite,
  sameVersion,
} from "../../shared/concurrency";
import { ApiError, StaleUpdateError } from "../../shared/errors";

const V1 = new Date("2026-09-01T10:00:00.000Z");
const V2 = new Date("2026-09-02T10:00:00.000Z");
const stored = { id: "a", updatedAt: V1 };
const notFound = new ApiError("NotFound", "Account not found");

describe("sameVersion", () => {
  it("compares the instant, not the object", () => {
    expect(sameVersion(new Date(V1.getTime()), V1)).toBe(true);
    expect(sameVersion(V2, V1)).toBe(false);
  });

  // A resource with no updatedAt cannot satisfy a guard.
  it("never matches a missing version", () => {
    expect(sameVersion(undefined, V1)).toBe(false);
  });
});

describe("assertFresh", () => {
  it("does nothing without a guard", () => {
    expect(() => assertFresh(stored, undefined, () => stored)).not.toThrow();
  });

  it("does nothing when the versions match", () => {
    expect(() =>
      assertFresh(stored, new Date(V1.getTime()), () => stored),
    ).not.toThrow();
  });

  it("reports STALE_UPDATE with the server's copy", () => {
    let thrown: unknown;
    try {
      assertFresh(stored, V2, (s) => ({ ...s, presented: true }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(StaleUpdateError);
    expect(thrown).toMatchObject({
      code: "STALE_UPDATE",
      statusCode: 409,
      current: { id: "a", presented: true },
    });
  });
});

describe("guardedWrite", () => {
  it("returns the write's result when it lands", async () => {
    const write = jest.fn<Promise<string>, []>().mockResolvedValue("done");
    const reread = jest.fn();
    await expect(guardedWrite(V1, write, reread, (s) => s)).resolves.toBe(
      "done",
    );
    expect(reread).not.toHaveBeenCalled();
  });

  // The filter matched nothing because somebody else wrote first.
  it("turns a lost race into STALE_UPDATE with the current resource", async () => {
    const write = jest.fn().mockRejectedValue(notFound);
    const reread = jest.fn().mockResolvedValue({ id: "a", updatedAt: V2 });

    await expect(
      guardedWrite(V1, write, reread, (s) => s),
    ).rejects.toMatchObject({ code: "STALE_UPDATE", current: { id: "a" } });
  });

  it("keeps the 404 when the resource really is gone", async () => {
    const write = jest.fn().mockRejectedValue(notFound);
    const reread = jest.fn().mockResolvedValue(null);

    await expect(guardedWrite(V1, write, reread, (s) => s)).rejects.toBe(
      notFound,
    );
  });

  // Same version stored: the miss was the archived/deleted filter, not the guard.
  it("keeps the 404 when the version still matches", async () => {
    const write = jest.fn().mockRejectedValue(notFound);
    const reread = jest.fn().mockResolvedValue({ id: "a", updatedAt: V1 });

    await expect(guardedWrite(V1, write, reread, (s) => s)).rejects.toBe(
      notFound,
    );
  });

  it("does not re-read when there is no guard", async () => {
    const write = jest.fn().mockRejectedValue(notFound);
    const reread = jest.fn();

    await expect(guardedWrite(undefined, write, reread, (s) => s)).rejects.toBe(
      notFound,
    );
    expect(reread).not.toHaveBeenCalled();
  });

  it("lets any other failure through", async () => {
    const boom = new Error("connection reset");
    const write = jest.fn().mockRejectedValue(boom);
    await expect(guardedWrite(V1, write, jest.fn(), (s) => s)).rejects.toBe(
      boom,
    );
  });
});
