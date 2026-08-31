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

jest.mock("mongoose", () => ({
  __esModule: true,
  default: {
    set: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    connection: { readyState: 0 },
    STATES: { connected: 1 },
    models: {},
  },
}));

const remoteWarning = (): unknown[][] =>
  mockLogger.warn.mock.calls.filter((c) =>
    String(c[1]).includes("remote database"),
  );

// connectMongo memoises its in-flight promise, so each case needs a fresh copy
// of the module or only the first one would run the check.
const connectFresh = async (): Promise<void> => {
  jest.resetModules();
  const { connectMongo } = await import("../../config/mongoConnection");
  await connectMongo();
};

describe("connectMongo — development pointed at a remote database", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    "mongodb://localhost:27017/lag_money?replicaSet=rs0",
    "mongodb://127.0.0.1:27017/lag_money",
    "mongodb://mongo:27017/lag_money?directConnection=true",
  ])("stays quiet for the local URI %s", async (uri) => {
    mockEnv.MONGO_URI = uri;
    await connectFresh();
    expect(remoteWarning()).toHaveLength(0);
  });

  it.each([
    "mongodb://user:pass@ac-abc-shard-00-00.xxx.mongodb.net:27017/lag_money?ssl=true",
    "mongodb+srv://user:pass@cluster0.xxx.mongodb.net/lag_money",
  ])("warns for the remote URI %s", async (uri) => {
    mockEnv.MONGO_URI = uri;
    await connectFresh();
    const warnings = remoteWarning();
    expect(warnings).toHaveLength(1);
    expect(warnings[0][0]).toEqual({
      host: expect.stringContaining("mongodb.net"),
    });
  });

  it("never warns outside development", async () => {
    mockEnv.NODE_ENV = "production";
    mockEnv.MONGO_URI = "mongodb+srv://user:pass@cluster0.xxx.mongodb.net/lag";
    await connectFresh();
    expect(remoteWarning()).toHaveLength(0);
    mockEnv.NODE_ENV = "development";
  });
});
