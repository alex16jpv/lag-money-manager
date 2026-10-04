import { readFileSync } from "fs";
import path from "path";

import {
  emailParametersFrom,
  fillAccount,
  importTemplate,
} from "../../../scripts/infra/changeSet";
import { API_SECRETS } from "../../../scripts/infra/parts";
import {
  declaredEnvironment,
  parseTemplate,
} from "../../../scripts/infra/template";
import { mongoEnvSchema } from "../../shared/constants";
import { loadTemplate, REPO, type Template } from "./cloudFormation";

const api = loadTemplate("infra/api.yaml");
const access = loadTemplate("infra/access.yaml");
const email = loadTemplate("infra/email.yaml");

type ImportPlan = {
  resources: Record<string, Record<string, string>>;
  asItIs?: Record<string, Record<string, unknown>>;
};
const importPlan = (part: string): ImportPlan =>
  JSON.parse(
    readFileSync(path.join(REPO, `infra/import/${part}.json`), "utf8"),
  ) as ImportPlan;

const IDENTIFIERS: Record<string, string[]> = {
  "AWS::IAM::Role": ["RoleName"],
  "AWS::IAM::ManagedPolicy": ["PolicyArn"],
  "AWS::IAM::User": ["UserName"],
  "AWS::IAM::UserPolicy": ["PolicyName", "UserName"],
  "AWS::Logs::LogGroup": ["LogGroupName"],
  "AWS::Lambda::Function": ["FunctionName"],
  "AWS::Lambda::Url": ["FunctionArn"],
  "AWS::Lambda::Permission": ["FunctionName", "Id"],
  "AWS::Events::Rule": ["Arn"],
};

const apiEnvironment = (): Record<string, unknown> =>
  (
    api.Resources.ApiFunction.Properties.Environment as {
      Variables: Record<string, unknown>;
    }
  ).Variables;

describe("the api stack", () => {
  it("starts the API in production with what it declares", () => {
    const secrets: Record<string, string> = {
      MongoUri: "mongodb+srv://user:pass@cluster.example.net/lag_money",
      JwtSecret: "x".repeat(64),
      RefreshSecret: "y".repeat(64),
      ApiSecret: "z".repeat(64),
      TurnstileSecret: "0x4AAAAAAA-real-looking-secret",
    };
    const env = declaredEnvironment(api, "ApiFunction", secrets, {
      account: "123456789012",
      region: "us-east-1",
    });
    expect(mongoEnvSchema.safeParse(env).error).toBeUndefined();
    expect(env.NODE_ENV).toBe("production");
  });

  it("declares only variables the API reads", () => {
    const known = Object.keys(mongoEnvSchema.shape);
    expect(
      Object.keys(apiEnvironment()).filter((name) => !known.includes(name)),
    ).toEqual([]);
  });

  it("takes every secret from a hidden parameter, and nothing else from one", () => {
    const fromParameters = Object.entries(apiEnvironment())
      .filter(
        ([, value]) => typeof value === "object" && "Ref" in (value as object),
      )
      .map(([name, value]) => [name, (value as { Ref: string }).Ref]);
    expect(Object.fromEntries(fromParameters)).toEqual(
      Object.fromEntries(
        API_SECRETS.map(({ variable, parameter }) => [variable, parameter]),
      ),
    );
    for (const { parameter } of API_SECRETS) {
      expect(api.Parameters[parameter]).toMatchObject({ NoEcho: true });
      expect(api.Parameters[parameter]?.Default).toBeUndefined();
    }
  });

  it("names the events topic the email stack creates", () => {
    expect(apiEnvironment().EMAIL_SES_EVENTS_TOPIC_ARN).toEqual({
      "Fn::Sub": `arn:\${AWS::Partition}:sns:\${AWS::Region}:\${AWS::AccountId}:${String(
        (email.Resources.EventsTopic.Properties as { TopicName: string })
          .TopicName,
      )}`,
    });
    expect(apiEnvironment().EMAIL_SES_CONFIGURATION_SET).toBe(
      email.Parameters.ConfigurationSetName?.Default,
    );
  });

  it("keeps the API's logs 30 days [T-246]", () => {
    expect(api.Resources.ApiLogGroup.Properties.RetentionInDays).toBe(30);
  });

  it("leaves the role's attached policies to whoever attaches them, so the budget's deny survives a deploy", () => {
    expect(api.Resources.ApiRole.Properties).not.toHaveProperty(
      "ManagedPolicyArns",
    );
    expect(api.Resources.ApiRole.Properties).not.toHaveProperty("Policies");
    expect(api.Resources.ApiLogsPolicy.Properties.Roles).toEqual([
      { Ref: "ApiRole" },
    ]);
  });

  it("never uploads code: the placeholder stays as it is and deploy:lambda owns the code", () => {
    const code = api.Resources.ApiFunction.Properties.Code as {
      ZipFile: string;
    };
    expect(code.ZipFile).toContain("npm run deploy:lambda");
    expect(api.Resources.ApiFunction.Properties.Handler).toBe(
      "dist/lambda.handler",
    );
    const deployScript = readFileSync(
      path.join(REPO, "scripts/deploy-lambda.sh"),
      "utf8",
    );
    expect(deployScript).toContain('"dist/lambda.handler"');
  });

  it("gives infra/email.yaml a webhook URL its pattern accepts", () => {
    const pattern = new RegExp(
      email.Parameters.WebhookUrl?.AllowedPattern ?? "",
    );
    expect(
      `https://abc.lambda-url.us-east-1.on.aws/webhooks/email/ses`,
    ).toMatch(pattern);
    const parameters = emailParametersFrom([
      { OutputKey: "FunctionName", OutputValue: "ledgerflow" },
      { OutputKey: "RoleName", OutputValue: "ledgerflow-role" },
      { OutputKey: "RolePath", OutputValue: "/service-role/" },
      {
        OutputKey: "FunctionUrl",
        OutputValue: "https://abc.lambda-url.us-east-1.on.aws/",
      },
    ]);
    expect(
      parameters.find(({ ParameterKey }) => ParameterKey === "WebhookUrl")
        ?.ParameterValue,
    ).toMatch(pattern);
    expect(Object.keys(api.Outputs ?? {})).toEqual(
      expect.arrayContaining([
        "FunctionName",
        "RoleName",
        "RolePath",
        "FunctionUrl",
      ]),
    );
  });
});

describe.each([
  ["api", api],
  ["access", access],
])("the %s stack", (part, template: Template) => {
  it("keeps every resource if it is ever removed from the stack", () => {
    for (const [id, resource] of Object.entries(template.Resources)) {
      expect([
        id,
        resource.DeletionPolicy,
        resource.UpdateReplacePolicy,
      ]).toEqual([id, "Retain", "Retain"]);
    }
  });

  it("adopts what exists by the identifier CloudFormation asks for", () => {
    const { resources } = importPlan(part);
    for (const [id, identifier] of Object.entries(resources)) {
      const type = template.Resources[id]?.Type;
      expect([id, Object.keys(identifier).sort()]).toEqual([
        id,
        [...(IDENTIFIERS[type ?? ""] ?? ["unknown type"])].sort(),
      ]);
    }
  });

  it("adopts every resource exactly as the next deploy declares it, but what it describes as it was", () => {
    const plan = importPlan(part);
    const text = readFileSync(path.join(REPO, `infra/${part}.yaml`), "utf8");
    const adopted = parseTemplate(
      importTemplate(
        text,
        Object.keys(plan.resources),
        fillAccount(plan.asItIs ?? {}, "123456789012", "us-east-1"),
      ),
    );
    for (const id of Object.keys(plan.resources)) {
      if (id in (plan.asItIs ?? {})) continue;
      expect([id, adopted.Resources[id]]).toEqual([id, template.Resources[id]]);
    }
  });
});

describe("adopting what exists", () => {
  it("adopts every resource of the api stack, the logs as they were so the next deploy gives them their 30 days", () => {
    const plan = importPlan("api");
    expect(Object.keys(plan.resources).sort()).toEqual(
      Object.keys(api.Resources).sort(),
    );
    expect(plan.asItIs).toEqual({
      ApiLogGroup: {
        LogGroupName: api.Resources.ApiLogGroup.Properties.LogGroupName,
      },
    });
  });

  it("adopts the deploy user and its policies, and creates only the check's permission", () => {
    const plan = importPlan("access");
    expect(
      Object.keys(access.Resources).filter((id) => !(id in plan.resources)),
    ).toEqual(["InfraCheckPolicy"]);
  });

  it("adopts the deploy policy as it is, so the next deploy takes away what only the keepalive script used", () => {
    const actions = (
      properties: Record<string, unknown> | undefined,
    ): string[] =>
      (
        properties?.PolicyDocument as {
          Statement: { Action: string | string[] }[];
        }
      ).Statement.flatMap(({ Action }) => Action);
    const today = actions(importPlan("access").asItIs?.DeployPolicy);
    const declared = actions(access.Resources.DeployPolicy.Properties);
    expect(today.filter((action) => !declared.includes(action)).sort()).toEqual(
      [
        "events:DescribeRule",
        "events:PutRule",
        "events:PutTargets",
        "lambda:AddPermission",
        "lambda:UpdateFunctionConfiguration",
      ],
    );
    expect(declared.filter((action) => !today.includes(action))).toEqual([]);
  });

  it("names nothing of the account but through {account} and {region}", () => {
    for (const part of ["api", "access"]) {
      const text = readFileSync(
        path.join(REPO, `infra/import/${part}.json`),
        "utf8",
      );
      expect(text).not.toMatch(/\d{12}/);
      expect(text).not.toMatch(/us-east-1/);
    }
  });
});
