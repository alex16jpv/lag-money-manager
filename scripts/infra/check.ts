import {
  aws,
  AwsError,
  type DeploySettings,
  deploySettings,
  ensureSession,
} from "./aws";
import { detectDrift } from "./drift";
import { undeclared } from "./inventory";
import { API_SECRETS, PARTS, secretParameterName } from "./parts";

type StackResource = {
  LogicalResourceId: string;
  PhysicalResourceId: string;
  ResourceType: string;
};

const INVENTORY: Record<
  string,
  { type: string; list: (s: DeploySettings) => string[] }
> = {
  "Lambda functions": {
    type: "AWS::Lambda::Function",
    list: (s) =>
      (
        aws(s, ["lambda", "list-functions"]).Functions as {
          FunctionName: string;
        }[]
      ).map((f) => f.FunctionName),
  },
  "EventBridge rules": {
    type: "AWS::Events::Rule",
    list: (s) =>
      (aws(s, ["events", "list-rules"]).Rules as { Name: string }[]).map(
        (r) => r.Name,
      ),
  },
  "IAM users": {
    type: "AWS::IAM::User",
    list: (s) =>
      (aws(s, ["iam", "list-users"]).Users as { UserName: string }[]).map(
        (u) => u.UserName,
      ),
  },
  "IAM roles": {
    type: "AWS::IAM::Role",
    list: (s) =>
      (
        aws(s, ["iam", "list-roles"]).Roles as {
          RoleName: string;
          Path: string;
        }[]
      )
        .filter((r) => !r.Path.startsWith("/aws-service-role/"))
        .map((r) => r.RoleName),
  },
  "IAM policies": {
    type: "AWS::IAM::ManagedPolicy",
    list: (s) =>
      (
        aws(s, ["iam", "list-policies", "--scope", "Local"]).Policies as {
          Arn: string;
        }[]
      ).map((p) => p.Arn),
  },
  "SNS topics": {
    type: "AWS::SNS::Topic",
    list: (s) =>
      (aws(s, ["sns", "list-topics"]).Topics as { TopicArn: string }[]).map(
        (t) => t.TopicArn,
      ),
  },
  "Log groups": {
    type: "AWS::Logs::LogGroup",
    list: (s) =>
      (
        aws(s, ["logs", "describe-log-groups"]).logGroups as {
          logGroupName: string;
        }[]
      ).map((g) => g.logGroupName),
  },
  "CloudWatch alarms": {
    type: "AWS::CloudWatch::Alarm",
    list: (s) =>
      (
        aws(s, ["cloudwatch", "describe-alarms"]).MetricAlarms as {
          AlarmName: string;
        }[]
      ).map((a) => a.AlarmName),
  },
  "SES identities": {
    type: "AWS::SES::EmailIdentity",
    list: (s) =>
      (
        aws(s, ["sesv2", "list-email-identities"]).EmailIdentities as {
          IdentityName: string;
        }[]
      ).map((i) => i.IdentityName),
  },
};

function stackResources(
  settings: DeploySettings,
  stack: string,
): StackResource[] | undefined {
  try {
    aws(settings, ["cloudformation", "describe-stacks", "--stack-name", stack]);
  } catch (err) {
    if (err instanceof AwsError && err.notFound) return undefined;
    throw err;
  }
  return (
    aws(settings, [
      "cloudformation",
      "list-stack-resources",
      "--stack-name",
      stack,
    ]) as {
      StackResourceSummaries: StackResource[];
    }
  ).StackResourceSummaries;
}

function beyondTheTemplates(
  settings: DeploySettings,
  resources: StackResource[],
): string[] {
  const physical = (logical: string): string | undefined =>
    resources.find(({ LogicalResourceId }) => LogicalResourceId === logical)
      ?.PhysicalResourceId;
  const problems: string[] = [];
  const role = physical("ApiRole");
  if (role) {
    const attached = (
      aws(settings, ["iam", "list-attached-role-policies", "--role-name", role])
        .AttachedPolicies as { PolicyArn: string }[]
    ).map(({ PolicyArn }) => PolicyArn);
    const allowed = [
      physical("ApiLogsPolicy"),
      physical("DenySendPolicy"),
    ].filter((arn): arn is string => Boolean(arn));
    for (const arn of attached.filter((arn) => !allowed.includes(arn))) {
      problems.push(
        `The API's role: ${arn} is attached, and no template attaches it`,
      );
    }
    const inline = aws(settings, [
      "iam",
      "list-role-policies",
      "--role-name",
      role,
    ]).PolicyNames as string[];
    for (const name of inline.filter(
      (name) => name !== "ledger-flow-send-email",
    )) {
      problems.push(`The API's role: inline policy ${name} is in no template`);
    }
  }
  const fn = physical("ApiFunction");
  if (fn) {
    const policy = JSON.parse(
      String(
        aws(settings, ["lambda", "get-policy", "--function-name", fn]).Policy,
      ),
    ) as { Statement: { Sid: string }[] };
    const permissions = resources
      .filter(({ ResourceType }) => ResourceType === "AWS::Lambda::Permission")
      .map(({ PhysicalResourceId }) => PhysicalResourceId);
    for (const sid of undeclared(
      policy.Statement.map(({ Sid }) => Sid),
      permissions,
    )) {
      problems.push(`The API's function: permission ${sid} is in no template`);
    }
    const url = aws(settings, [
      "lambda",
      "get-function-url-config",
      "--function-name",
      fn,
    ]);
    if (url.Cors)
      problems.push("The API's URL: it has CORS, and no template gives it");
  }
  const user = physical("DeployUser");
  if (user) {
    const keys = aws(settings, ["iam", "list-access-keys", "--user-name", user])
      .AccessKeyMetadata as unknown[];
    if (keys.length > 1)
      problems.push(`${user}: ${keys.length} access keys, where one is enough`);
    try {
      aws(settings, ["iam", "get-login-profile", "--user-name", user]);
      problems.push(
        `${user}: it can sign in to the console, and it should only deploy`,
      );
    } catch (err) {
      if (!(err instanceof AwsError && err.notFound)) throw err;
    }
  }
  return problems;
}

async function main(): Promise<void> {
  const settings = deploySettings("AWS_PROFILE");
  console.log(`==> Reading the account as ${ensureSession(settings).Arn}`);
  const problems: string[] = [];
  const declared: StackResource[] = [];

  for (const { stack } of Object.values(PARTS)) {
    const resources = stackResources(settings, stack);
    if (!resources) {
      problems.push(`${stack}: not deployed`);
      continue;
    }
    declared.push(...resources);
    const { StackStatus } = (
      aws(settings, [
        "cloudformation",
        "describe-stacks",
        "--stack-name",
        stack,
      ]) as {
        Stacks: { StackStatus: string }[];
      }
    ).Stacks[0] ?? { StackStatus: "UNKNOWN" };
    if (
      !StackStatus.endsWith("_COMPLETE") ||
      StackStatus.includes("ROLLBACK")
    ) {
      problems.push(`${stack}: ${StackStatus}`);
    }
    const drift = await detectDrift(settings, stack).catch((err: Error) => ({
      drifted: [`drift not checked: ${err.message}`],
      notCompared: [],
    }));
    problems.push(...drift.drifted.map((line) => `${stack}: ${line}`));
    console.log(
      `    ${stack}: ${StackStatus}, ${drift.drifted.length ? drift.drifted.join("; ") : "matches its template"}`,
    );
    if (drift.notCompared.length) {
      console.log(
        `      not compared by CloudFormation: ${drift.notCompared.join(", ")}`,
      );
    }
  }

  for (const [kind, { type, list }] of Object.entries(INVENTORY)) {
    const ofType = declared
      .filter(({ ResourceType }) => ResourceType === type)
      .map(({ PhysicalResourceId }) => PhysicalResourceId);
    problems.push(
      ...undeclared(list(settings), ofType).map(
        (name) => `${kind}: ${name} is in the account but in no stack`,
      ),
    );
  }
  problems.push(...beyondTheTemplates(settings, declared));

  const { Parameters } = aws(settings, [
    "ssm",
    "describe-parameters",
    "--parameter-filters",
    "Key=Path,Option=Recursive,Values=/ledger-flow/",
  ]) as { Parameters: { Name: string; Type: string }[] };
  for (const { variable } of API_SECRETS) {
    const found = Parameters.find(
      ({ Name }) => Name === secretParameterName(variable),
    );
    if (!found)
      problems.push(`SSM: ${secretParameterName(variable)} is missing`);
    else if (found.Type !== "SecureString") {
      problems.push(`SSM: ${found.Name} is ${found.Type}, not SecureString`);
    }
  }

  if (problems.length) {
    console.log(
      `==> The account does not match infra/*.yaml:\n  ${problems.join("\n  ")}`,
    );
    process.exit(1);
  }
  console.log("==> The account matches infra/*.yaml.");
}

main().catch((err: Error) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
