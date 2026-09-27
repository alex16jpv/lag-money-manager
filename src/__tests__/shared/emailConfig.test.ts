import type * as Providers from "../../infrastructure/email/emailProviders";
import type * as Constants from "../../shared/constants";
import { emailBudgetSlices } from "../../shared/emailBudgets";

const withEnv = async <T>(
  env: Record<string, string>,
  load: () => Promise<T>,
): Promise<T> => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    let loaded: T | undefined;
    await jest.isolateModulesAsync(async () => {
      loaded = await load();
    });
    return loaded as T;
  } finally {
    process.env = saved;
  }
};

const environment = (
  env: Record<string, string>,
): Promise<typeof Constants.ENVIRONMENT> =>
  withEnv(
    env,
    async () => (await import("../../shared/constants")).ENVIRONMENT,
  );

describe("email environment", () => {
  it("sends nothing until a provider is named, with the owner's caps", async () => {
    const env = await environment({});
    expect(env.EMAIL_PROVIDERS).toEqual([]);
    expect(env.EMAIL_SENDING_ENABLED).toBe(true);
    expect(env.EMAIL_DAILY_CAP).toBe(300);
    expect(env.EMAIL_MONTHLY_CAP).toBe(9000);
    expect(env.EMAIL_PROVIDER_TIMEOUT_MS).toBe(1500);
    expect(env.EMAIL_DEVICE_HOURLY_MAX).toBe(10);
    expect(env.EMAIL_IP_HOURLY_MAX).toBe(5);
    expect(env.EMAIL_FROM_ADDRESS).toBe("no-reply@ledgerflow.alexpiral.com");
    expect(env.EMAIL_REPLY_TO).toBe("ledgerflow@alexpiral.com");
    expect(env.APP_URL).toBe("https://ledgerflow.alexpiral.com");
  });

  it("reads the provider chain in order", async () => {
    expect(
      (await environment({ EMAIL_PROVIDERS: " ses , mailpit " }))
        .EMAIL_PROVIDERS,
    ).toEqual(["ses", "mailpit"]);
  });

  it.each([
    ["an unknown provider", { EMAIL_PROVIDERS: "sendgrid" }],
    ["a switch that is not true or false", { EMAIL_SENDING_ENABLED: "no" }],
    ["a sender name with a quote", { EMAIL_FROM_NAME: 'Ledger "Flow"' }],
    [
      "shares that leave nothing for security",
      { EMAIL_RESET_SHARE_PERCENT: "50", EMAIL_OTHER_SHARE_PERCENT: "50" },
    ],
    ["a cap whose reset share rounds to zero", { EMAIL_DAILY_CAP: "3" }],
    [
      "a sender name that is not plain ASCII",
      { EMAIL_FROM_NAME: "Ledger Flów" },
    ],
    [
      "mailpit in production",
      { NODE_ENV: "production", EMAIL_PROVIDERS: "mailpit" },
    ],
    [
      "links over http in production",
      { NODE_ENV: "production", APP_URL: "http://ledgerflow.alexpiral.com" },
    ],
  ])("refuses to start with %s", async (_label, env) => {
    await expect(environment(env)).rejects.toThrow();
  });

  it.each([
    ["false", false],
    ["False", false],
    [" 0 ", false],
    ["TRUE", true],
    ["1", true],
  ])("reads the switch %p as %p", async (value, expected) => {
    expect(
      (await environment({ EMAIL_SENDING_ENABLED: value }))
        .EMAIL_SENDING_ENABLED,
    ).toBe(expected);
  });

  it("accepts SES over https in production", async () => {
    expect(
      (await environment({ NODE_ENV: "production", EMAIL_PROVIDERS: "ses" }))
        .EMAIL_PROVIDERS,
    ).toEqual(["ses"]);
  });
});

describe("emailBudgetSlices", () => {
  it("splits the owner's default caps", () => {
    expect(emailBudgetSlices(300, 30, 20)).toEqual({
      reset: 90,
      other: 60,
      security: 150,
    });
    expect(emailBudgetSlices(9000, 30, 20)).toEqual({
      reset: 2700,
      other: 1800,
      security: 4500,
    });
  });

  it.each([1, 7, 13, 99, 301])(
    "never adds up to more than a cap of %i",
    (cap) => {
      const slices = emailBudgetSlices(cap, 33, 33);
      expect(slices.reset + slices.other + slices.security).toBe(cap);
      expect(Math.min(...Object.values(slices))).toBeGreaterThanOrEqual(0);
    },
  );
});

describe("createEmailProviders", () => {
  it("builds the chain the environment names, in its order", async () => {
    const names = await withEnv(
      { EMAIL_PROVIDERS: "mailpit,ses" },
      async () => {
        const providers: typeof Providers =
          await import("../../infrastructure/email/emailProviders");
        return providers.createEmailProviders().map((p) => p.name);
      },
    );
    expect(names).toEqual(["mailpit", "ses"]);
  });
});
