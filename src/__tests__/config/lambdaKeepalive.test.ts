const mockPing = jest.fn();
const mockRun = jest.fn();

jest.mock("../../config/dbHealth", () => ({ pingDatabase: mockPing }));
jest.mock("../../app/factories/nightlyPassFactory", () => ({
  createNightlyPassService: () => ({ run: mockRun }),
}));
jest.mock("../../app", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("@codegenie/serverless-express", () => ({
  __esModule: true,
  default: () => jest.fn(),
}));
jest.mock("../../shared/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import type { Context } from "aws-lambda";

import { handler, KEEPALIVE_EVENT_SOURCE } from "../../lambda";
import logger from "../../shared/logger";

const context = (remainingMs: number): Context =>
  ({ getRemainingTimeInMillis: () => remainingMs }) as unknown as Context;

describe("the daily keepalive [T-238]", () => {
  beforeEach(() => {
    mockPing.mockResolvedValue(undefined);
    mockRun.mockResolvedValue({});
  });

  it("pings the database, then runs the nightly pass within the invocation's time", async () => {
    await expect(
      handler({ source: KEEPALIVE_EVENT_SOURCE }, context(14_000)),
    ).resolves.toMatchObject({ ok: true });

    expect(mockPing).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith(10_000);
    expect(mockPing.mock.invocationCallOrder[0]).toBeLessThan(
      mockRun.mock.invocationCallOrder[0],
    );
  });

  it("leaves three seconds of a shorter invocation", async () => {
    await handler({ source: KEEPALIVE_EVENT_SOURCE }, context(8_000));

    expect(mockRun).toHaveBeenCalledWith(5_000);
  });

  it("runs no pass, and says so, when the ping left less than its reserve", async () => {
    await expect(
      handler({ source: KEEPALIVE_EVENT_SOURCE }, context(2_000)),
    ).resolves.toMatchObject({ ok: true });

    expect(mockRun).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "NIGHTLY_PASS_FAILED" }),
      expect.any(String),
    );
  });

  it("keeps the keepalive alive when the pass fails, and logs it", async () => {
    mockRun.mockRejectedValue(new Error("no connection"));

    await expect(
      handler({ source: KEEPALIVE_EVENT_SOURCE }, context(14_000)),
    ).resolves.toMatchObject({ ok: true });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "NIGHTLY_PASS_FAILED" }),
      expect.any(String),
    );
  });

  it("runs no pass when the ping itself fails", async () => {
    mockPing.mockRejectedValue(new Error("Atlas paused"));

    await expect(
      handler({ source: KEEPALIVE_EVENT_SOURCE }, context(14_000)),
    ).rejects.toThrow("Atlas paused");
    expect(mockRun).not.toHaveBeenCalled();
  });
});
