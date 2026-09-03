const mockEnv = { NODE_ENV: "development", MONGO_URI: "" };

jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: mockEnv,
  DB_TYPES: { MONGO: "MONGO" },
}));

// Stable instance: jest.resetModules() re-runs the factory, so a fresh object
// here would leave the assertions watching a logger nobody calls.
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.mock("../../shared/logger", () => mockLogger);

const mockModels: Record<string, { createIndexes: jest.Mock }> = {};

jest.mock("mongoose", () => ({
  __esModule: true,
  default: {
    set: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    connection: { readyState: 0 },
    STATES: { connected: 1 },
    get models() {
      return mockModels;
    },
  },
}));

// connectMongo memoises its in-flight promise, so each case needs a fresh copy
// of the module or only the first one would run.
const connectFresh = async (): Promise<void> => {
  jest.resetModules();
  const { connectMongo } = await import("../../config/mongoConnection");
  await connectMongo();
};

const duplicateKeyError = Object.assign(new Error("E11000 duplicate key"), {
  code: 11000,
});

const setModels = (defs: Record<string, jest.Mock>): void => {
  for (const key of Object.keys(mockModels)) delete mockModels[key];
  for (const [name, createIndexes] of Object.entries(defs)) {
    mockModels[name] = { createIndexes };
    (mockModels[name] as unknown as { modelName: string }).modelName = name;
  }
};

describe("connectMongo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.NODE_ENV = "development";
    mockEnv.MONGO_URI =
      "mongodb://user:secret@cluster0.xxx.mongodb.net:27017/lag_money?ssl=true";
  });

  it("logs the host it connected to, never the credentials", async () => {
    setModels({ User: jest.fn().mockResolvedValue(undefined) });
    await connectFresh();

    expect(mockLogger.info).toHaveBeenCalledWith(
      { host: "cluster0.xxx.mongodb.net:27017" },
      "Connected to MongoDB",
    );
    const logged = JSON.stringify(mockLogger.info.mock.calls);
    expect(logged).not.toContain("secret");
  });

  it("retries a transient index failure and stays quiet when it then works", async () => {
    const createIndexes = jest
      .fn()
      .mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"))
      .mockResolvedValueOnce(undefined);
    setModels({ Budget: createIndexes });

    await connectFresh();

    expect(createIndexes).toHaveBeenCalledTimes(2);
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("warns — not errors — when a transient failure survives the retry", async () => {
    setModels({
      Budget: jest.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND")),
    });

    await connectFresh();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ model: "Budget" }),
      expect.stringContaining("Could not verify indexes"),
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("errors on a data conflict and does not retry it", async () => {
    const createIndexes = jest.fn().mockRejectedValue(duplicateKeyError);
    setModels({ User: createIndexes });

    await connectFresh();

    expect(createIndexes).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ model: "User" }),
      expect.stringContaining("constraint NOT enforced"),
    );
  });

  it("does not touch indexes in production", async () => {
    mockEnv.NODE_ENV = "production";
    const createIndexes = jest.fn();
    setModels({ User: createIndexes });

    await connectFresh();

    expect(createIndexes).not.toHaveBeenCalled();
  });
});
