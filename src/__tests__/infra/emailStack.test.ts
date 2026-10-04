import { readdirSync, readFileSync } from "fs";
import path from "path";

import { ENVIRONMENT, SNS_TOPIC_ARN } from "../../shared/constants";
import { loadTemplate, REPO, type Resource } from "./cloudFormation";

const GUIDE = readFileSync(path.join(REPO, "docs/guides/email.md"), "utf8");
const SES_USD_PER_EMAIL = 0.1 / 1000;

const template = loadTemplate("infra/email.yaml");

const resourcesOf = (type: string): [string, Resource][] =>
  Object.entries(template.Resources).filter(([, r]) => r.Type === type);

const resource = (name: string): Resource => {
  const found = template.Resources[name];
  if (!found) throw new Error(`No resource ${name} in the template`);
  return found;
};

type Sent = { command: string; input: Record<string, unknown> };
type Command = { name: string; input: Record<string, unknown> };
type Handler = (event: unknown) => Promise<unknown>;

function loadPauseFunction(sesFails?: Error): {
  handler: Handler;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const command = (
    name: string,
  ): new (input: Record<string, unknown>) => Command =>
    class {
      constructor(public input: Record<string, unknown>) {}
      name = name;
    };
  const client = (
    fail?: Error,
  ): new () => { send: (cmd: Command) => Promise<object> } =>
    class {
      async send(cmd: Command): Promise<object> {
        sent.push({ command: cmd.name, input: cmd.input });
        if (fail) throw fail;
        return {};
      }
    };
  const modules: Record<string, Record<string, unknown>> = {
    "@aws-sdk/client-sesv2": {
      SESv2Client: client(sesFails),
      PutAccountSendingAttributesCommand: command(
        "PutAccountSendingAttributes",
      ),
    },
    "@aws-sdk/client-sns": {
      SNSClient: client(),
      PublishCommand: command("Publish"),
    },
  };
  const code = (
    resource("PauseFunction").Properties.Code as { ZipFile: string }
  ).ZipFile;
  const exports: { handler?: Handler } = {};
  const fakeRequire = (id: string): Record<string, unknown> => {
    const found = modules[id];
    if (!found)
      throw new Error(
        `The pause function requires ${id}, which the runtime may lack`,
      );
    return found;
  };
  const fakeProcess = {
    env: { ALERTS_TOPIC_ARN: "arn:aws:sns:us-east-1:123456789012:alerts" },
  };
  new Function("require", "exports", "process", code)(
    fakeRequire,
    exports,
    fakeProcess,
  );
  if (!exports.handler)
    throw new Error("The pause function exports no handler");
  return { handler: exports.handler, sent };
}

const alarmEvent = (
  ...messages: string[]
): { Records: { Sns: { Message: string } }[] } => ({
  Records: messages.map((Message) => ({ Sns: { Message } })),
});
const firing = (AlarmName: string, NewStateValue = "ALARM"): string =>
  JSON.stringify({ AlarmName, NewStateValue });

describe("the pause function", () => {
  it("pauses SES for the account and tells the owner which alarm fired", async () => {
    const { handler, sent } = loadPauseFunction();

    await expect(
      handler(alarmEvent(firing("ledger-flow-email-bounces-per-hour"))),
    ).resolves.toEqual({
      paused: true,
    });

    expect(sent).toEqual([
      {
        command: "PutAccountSendingAttributes",
        input: { SendingEnabled: false },
      },
      {
        command: "Publish",
        input: expect.objectContaining({
          TopicArn: "arn:aws:sns:us-east-1:123456789012:alerts",
          Subject: "Ledger Flow: SES sending is paused",
          Message: expect.stringContaining(
            "ledger-flow-email-bounces-per-hour",
          ),
        }),
      },
    ]);
  });

  it("says so and fails, so Lambda retries, when SES cannot be paused", async () => {
    const denied = Object.assign(new Error("not authorized"), {
      name: "AccessDeniedException",
    });
    const { handler, sent } = loadPauseFunction(denied);

    await expect(
      handler(alarmEvent(firing("ledger-flow-email-sends-per-hour"))),
    ).rejects.toBe(denied);

    expect(sent[1]).toEqual({
      command: "Publish",
      input: expect.objectContaining({
        Subject: "Ledger Flow: SES could NOT be paused",
        Message: expect.stringContaining(
          "AccessDeniedException: not authorized",
        ),
      }),
    });
  });

  it("does nothing for a message that is not an alarm going into ALARM", async () => {
    const { handler, sent } = loadPauseFunction();

    await expect(
      handler(
        alarmEvent(
          firing("ledger-flow-email-sends-per-hour", "OK"),
          "not json",
        ),
      ),
    ).resolves.toEqual({ paused: false });
    await expect(handler({})).resolves.toEqual({ paused: false });

    expect(sent).toEqual([]);
  });

  it("names every alarm of a batch in one pause", async () => {
    const { handler, sent } = loadPauseFunction();

    await handler(alarmEvent(firing("a"), firing("b")));

    expect(
      sent.filter((s) => s.command === "PutAccountSendingAttributes"),
    ).toHaveLength(1);
    expect(sent[1]?.input.Message).toContain("a, b fired");
  });
});

describe("the email stack", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory())
        return entry.name === "__tests__" ? [] : sourceFiles(full);
      return entry.name.endsWith(".ts") ? [full] : [];
    });
  const source = sourceFiles(path.join(REPO, "src"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  it("alarms on log codes the API really logs", () => {
    const filters = resourcesOf("AWS::Logs::MetricFilter");
    expect(filters).toHaveLength(2);
    for (const [name, filter] of filters) {
      const codes = [
        ...String(filter.Properties.FilterPattern).matchAll(
          /\$\.code = "([A-Z_]+)"/g,
        ),
      ].map((match) => match[1]);
      expect({ name, codes }).toEqual({ name, codes: expect.any(Array) });
      expect(codes.length).toBeGreaterThan(0);
      for (const code of codes) expect(source).toContain(`code: "${code}"`);
    }
  });

  it("tells the owner when the nightly pass needs a person, within the free alarms [T-238]", () => {
    const pattern = String(
      resource("NeedsAttentionFilter").Properties.FilterPattern,
    );
    for (const code of [
      "EMAIL_CAP_REACHED",
      "ACCOUNT_ERASE_FAILED",
      "ACCOUNT_ERASE_BACKLOG",
      "NIGHTLY_PASS_FAILED",
    ]) {
      expect(pattern).toContain(`$.code = "${code}"`);
    }
    expect(resourcesOf("AWS::CloudWatch::Alarm").length).toBeLessThanOrEqual(8);
  });

  it("publishes to the webhook the events it reads, in the envelope it verifies", () => {
    const destination = resource("EventsDestination").Properties
      .EventDestination as {
      MatchingEventTypes: string[];
    };
    expect([...destination.MatchingEventTypes].sort()).toEqual([
      "bounce",
      "complaint",
      "delivery",
    ]);

    const subscription = resource("EventsSubscription");
    expect(subscription.Condition).toBe("HasWebhook");
    expect(template.Parameters.WebhookUrl?.Default).toBe("");
    expect(subscription.Properties.RawMessageDelivery).toBe(false);
    expect(
      readFileSync(
        path.join(REPO, "src/app/routes/emailWebhookRoutes.ts"),
        "utf8",
      ),
    ).toMatch(/router\.post\(\s*"\/ses"/);
    expect(readFileSync(path.join(REPO, "src/app.ts"), "utf8")).toContain(
      '"/webhooks/email"',
    );
  });

  it("retries a failed delivery for longer than SNS's default, inside its one-hour limit", () => {
    const policy = (
      resource("EventsSubscription").Properties.DeliveryPolicy as {
        healthyRetryPolicy: Record<string, number | string>;
      }
    ).healthyRetryPolicy;
    const n = (key: string): number => Number(policy[key]);
    const backoff =
      n("numRetries") -
      n("numNoDelayRetries") -
      n("numMinDelayRetries") -
      n("numMaxDelayRetries");
    const worst =
      n("numMinDelayRetries") * n("minDelayTarget") +
      backoff * n("maxDelayTarget") +
      n("numMaxDelayRetries") * n("maxDelayTarget");

    expect(backoff).toBeGreaterThanOrEqual(0);
    expect(n("numRetries")).toBeGreaterThan(3);
    expect(worst).toBeLessThanOrEqual(3600);
  });

  it("names its events topic in a way the API accepts as EMAIL_SES_EVENTS_TOPIC_ARN", () => {
    const name = resource("EventsTopic").Properties.TopicName;
    expect(`arn:aws:sns:us-east-1:123456789012:${name}`).toMatch(SNS_TOPIC_ARN);
  });

  it("tells the owner about every alarm, and pauses SES only on the sending ones", () => {
    const alarms = resourcesOf("AWS::CloudWatch::Alarm");
    const trips = alarms.filter(([, a]) =>
      (a.Properties.AlarmActions as unknown[]).some(
        (x) => JSON.stringify(x) === '{"Ref":"TripTopic"}',
      ),
    );
    for (const [, alarm] of alarms) {
      expect(alarm.Properties.AlarmActions).toContainEqual({
        Ref: "AlertsTopic",
      });
      expect(alarm.Properties.TreatMissingData).toBe("notBreaching");
    }
    expect(trips.map(([name]) => name).sort()).toEqual([
      "BounceRateAlarm",
      "BouncesAlarm",
      "ComplaintRateAlarm",
      "ComplaintsAlarm",
      "SendsAlarm",
    ]);
  });

  it("denies the API's role every SES send the stack allows it", () => {
    const allowed = (
      resource("ApiSendPolicy").Properties.PolicyDocument as {
        Statement: { Action: string }[];
      }
    ).Statement.map((s) => s.Action);
    const denied = (
      resource("DenySendPolicy").Properties.PolicyDocument as {
        Statement: { Effect: string; Action: string }[];
      }
    ).Statement;
    expect(denied).toEqual([
      expect.objectContaining({ Effect: "Deny", Action: "ses:Send*" }),
    ]);
    for (const action of allowed) expect(action).toMatch(/^ses:Send/);

    const action = resource("EmailBudgetAction").Properties;
    expect(action.ApprovalModel).toBe("AUTOMATIC");
    expect(action.Definition).toEqual({
      IamActionDefinition: {
        PolicyArn: { Ref: "DenySendPolicy" },
        Roles: [{ Ref: "ApiRoleName" }],
      },
    });
  });

  it("lets the budget act on the API's role by its real ARN, path included", () => {
    const statement = (
      resource("BudgetActionRole").Properties.Policies as {
        PolicyDocument: { Statement: { Resource: { "Fn::Sub": string } }[] };
      }[]
    )[0]?.PolicyDocument.Statement[0];
    const values: Record<string, string> = {
      "AWS::Partition": "aws",
      "AWS::AccountId": "231016596536",
      ApiRolePath: "/service-role/",
      ApiRoleName: "ledgerflow-role-o9zw65c1",
    };
    const arn = statement?.Resource["Fn::Sub"].replace(
      /\$\{([^}]+)\}/g,
      (_, name: string) => values[name] ?? `<${name}>`,
    );
    expect(arn).toBe(
      "arn:aws:iam::231016596536:role/service-role/ledgerflow-role-o9zw65c1",
    );
  });

  it("takes a role path only in the shape IAM writes it", () => {
    const pattern = new RegExp(
      `^(?:${template.Parameters.ApiRolePath?.AllowedPattern ?? ""})$`,
    );
    for (const path of ["/", "/service-role/", "/a/b/"]) {
      expect(path).toMatch(pattern);
    }
    for (const path of ["", "service-role", "/service-role", "service-role/"]) {
      expect(path).not.toMatch(pattern);
    }
  });

  it("keeps the domain identity, unless creating it is what failed", () => {
    expect(resource("EmailIdentity").DeletionPolicy).toBe(
      "RetainExceptOnCreate",
    );
  });

  it("signs the events with SHA-256", () => {
    expect(resource("EventsTopic").Properties.SignatureVersion).toBe("2");
  });

  it("has the guide's deploy command pass every value the owner must look up", () => {
    const command =
      /aws cloudformation deploy[\s\S]*?```/.exec(GUIDE)?.[0] ?? "";
    const required = Object.entries(template.Parameters)
      .filter(([, p]) => p.Default === undefined)
      .map(([name]) => name);
    expect(required).toEqual(
      expect.arrayContaining(["ApiFunctionName", "ApiRoleName", "ApiRolePath"]),
    );
    for (const name of required) {
      expect(command).toContain(`${name}=`);
    }
  });

  describe("the guide's table of limits", () => {
    const rows = [
      ...GUIDE.matchAll(/^\| \**(\d+) USD\** [^|]*((?:\| [\d,]+ )+)\|$/gm),
    ].map(([, usd, cells]) => [
      Number(usd),
      ...(cells ?? "")
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => Number(c.replace(/,/g, ""))),
    ]);

    it("has one row per spending step", () => {
      expect(rows.map(([usd]) => usd)).toEqual([1, 5, 20]);
    });

    it("starts from the API's caps and the template's defaults", () => {
      const defaults = template.Parameters;
      expect(rows[0]).toEqual([
        1,
        ENVIRONMENT.EMAIL_MONTHLY_CAP,
        ENVIRONMENT.EMAIL_DAILY_CAP,
        ENVIRONMENT.EMAIL_DAILY_CAP,
        defaults.SendsPerHourAlarm?.Default,
        defaults.BouncesPerHourAlarm?.Default,
        defaults.ComplaintsPerDayAlarm?.Default,
        defaults.MonthlyBudgetUsd?.Default,
      ]);
    });

    it("keeps every step's caps under its budget and its alarm under its day", () => {
      for (const [usd, monthly, daily, quota, sends, , , budget] of rows) {
        expect({ usd, budget }).toEqual({ usd, budget: usd });
        expect(Number(monthly) * SES_USD_PER_EMAIL).toBeLessThan(
          Number(budget),
        );
        expect(Number(daily) * 30).toBe(monthly);
        expect(quota).toBe(daily);
        expect(Number(sends)).toBeLessThan(Number(daily));
      }
    });
  });
});
