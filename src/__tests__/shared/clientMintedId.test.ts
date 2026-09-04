import {
  CreateOrReplay,
  createOrReplay,
  isDuplicateIdError,
} from "../../shared/clientMintedId";
import { ApiError } from "../../shared/errors";

const dupKey = (keyPattern: Record<string, number>): Error =>
  Object.assign(new Error("E11000 duplicate key"), {
    name: "MongoServerError",
    code: 11000,
    keyPattern,
  });

describe("isDuplicateIdError", () => {
  it("recognises a duplicate on the _id index", () => {
    expect(isDuplicateIdError(dupKey({ _id: 1 }))).toBe(true);
  });

  it("falls back to keyValue when the driver omits keyPattern", () => {
    const err = Object.assign(new Error("E11000"), {
      code: 11000,
      keyValue: { _id: "abc" },
    });
    expect(isDuplicateIdError(err)).toBe(true);
  });

  // A business uniqueness rule must keep its own code: the front branches on it.
  it("ignores a duplicate raised by another unique index", () => {
    expect(isDuplicateIdError(dupKey({ userId: 1, name: 1 }))).toBe(false);
    expect(
      isDuplicateIdError(dupKey({ userId: 1, type: 1, periodType: 1 })),
    ).toBe(false);
  });

  it("ignores anything that is not a duplicate key error", () => {
    expect(isDuplicateIdError(new Error("boom"))).toBe(false);
    expect(isDuplicateIdError(null)).toBe(false);
    expect(isDuplicateIdError({ code: 121 })).toBe(false);
  });
});

interface Stored {
  id: string;
  name: string;
}

interface Op extends CreateOrReplay<Stored, Stored> {
  findOwn: jest.Mock<Promise<Stored | null>, [string]>;
  matches: jest.Mock<boolean, [Stored]>;
  replay: jest.Mock<Promise<Stored>, [Stored]>;
  create: jest.Mock<Promise<Stored>, []>;
}

describe("createOrReplay", () => {
  const stored: Stored = { id: "a", name: "Savings" };

  const op = (over: Partial<Op> = {}): Op => ({
    clientId: "a",
    findOwn: jest
      .fn<Promise<Stored | null>, [string]>()
      .mockResolvedValue(null),
    matches: jest.fn<boolean, [Stored]>().mockReturnValue(true),
    replay: jest.fn<Promise<Stored>, [Stored]>(async (s) => s),
    create: jest.fn<Promise<Stored>, []>().mockResolvedValue(stored),
    ...over,
  });

  it("creates without looking anything up when the client sent no id", async () => {
    const o = op({ clientId: undefined });
    await expect(createOrReplay(o)).resolves.toBe(stored);
    expect(o.findOwn).not.toHaveBeenCalled();
  });

  it("creates when the id is free", async () => {
    const o = op();
    await expect(createOrReplay(o)).resolves.toBe(stored);
    expect(o.create).toHaveBeenCalled();
  });

  // Checked before creating: the second attempt would trip the name or period
  // uniqueness rule the first one already satisfied.
  it("replays without creating when the id is already the user's", async () => {
    const outcome = { replayed: false };
    const o = op({ findOwn: jest.fn().mockResolvedValue(stored), outcome });
    await expect(createOrReplay(o)).resolves.toBe(stored);
    expect(o.create).not.toHaveBeenCalled();
    expect(outcome.replayed).toBe(true);
  });

  it("reports ID_TAKEN when the stored payload differs", async () => {
    const outcome = { replayed: false };
    const o = op({
      findOwn: jest.fn().mockResolvedValue(stored),
      matches: jest.fn().mockReturnValue(false),
      outcome,
    });
    await expect(createOrReplay(o)).rejects.toMatchObject({
      code: "ID_TAKEN",
      statusCode: 409,
    });
    expect(outcome.replayed).toBe(false);
  });

  it("reports ID_TAKEN for an id owned by somebody else", async () => {
    const o = op({ create: jest.fn().mockRejectedValue(dupKey({ _id: 1 })) });
    await expect(createOrReplay(o)).rejects.toBeInstanceOf(ApiError);
    await expect(createOrReplay(o)).rejects.toMatchObject({
      code: "ID_TAKEN",
    });
  });

  it("replays when a concurrent request won the race with the same payload", async () => {
    const findOwn = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(stored);
    const outcome = { replayed: false };
    const o = op({
      findOwn,
      outcome,
      create: jest.fn().mockRejectedValue(dupKey({ _id: 1 })),
    });
    await expect(createOrReplay(o)).resolves.toBe(stored);
    expect(outcome.replayed).toBe(true);
  });

  it("lets every other failure through untouched", async () => {
    const boom = new Error("connection reset");
    const o = op({ create: jest.fn().mockRejectedValue(boom) });
    await expect(createOrReplay(o)).rejects.toBe(boom);
  });
});
