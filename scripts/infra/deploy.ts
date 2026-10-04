import { readFileSync } from "fs";
import path from "path";
import { createInterface } from "readline/promises";
import { parseArgs } from "util";

import {
  aws,
  AwsError,
  awsWithInput,
  type DeploySettings,
  deploySettings,
  ensureSession,
  REPO,
} from "./aws";
import {
  blockers,
  type ChangeSetType,
  describeChange,
  emailParametersFrom,
  fillAccount,
  importTemplate,
  isNoChange,
  type Parameter,
  type ResourceChange,
  resourceTypes,
  STACK_POLICY,
} from "./changeSet";
import { detectDrift } from "./drift";
import { API_SECRETS, type Part, PARTS, secretParameterName } from "./parts";
import {
  declaredEnvironment,
  differentVariables,
  parseTemplate,
} from "./template";

type Stack = {
  StackStatus: string;
  Outputs?: { OutputKey: string; OutputValue: string }[];
};

type ImportPlan = {
  resources: Record<string, Record<string, string>>;
  asItIs?: Record<string, Record<string, unknown>>;
};

function stackOf(settings: DeploySettings, name: string): Stack | undefined {
  try {
    const { Stacks } = aws(settings, [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      name,
    ]) as { Stacks: Stack[] };
    return Stacks[0]?.StackStatus === "REVIEW_IN_PROGRESS"
      ? undefined
      : Stacks[0];
  } catch (err) {
    if (err instanceof AwsError && err.notFound) return undefined;
    throw err;
  }
}

function secretParameters(settings: DeploySettings): Parameter[] {
  const { Parameters, InvalidParameters } = aws(settings, [
    "ssm",
    "get-parameters",
    "--with-decryption",
    "--names",
    ...API_SECRETS.map(({ variable }) => secretParameterName(variable)),
  ]) as {
    Parameters: { Name: string; Value: string }[];
    InvalidParameters: string[];
  };
  if (InvalidParameters.length) {
    throw new Error(
      `Missing in SSM Parameter Store: ${InvalidParameters.join(", ")} (docs/guides/aws.md, The secrets).`,
    );
  }
  return API_SECRETS.map(({ variable, parameter }) => ({
    ParameterKey: parameter,
    ParameterValue: Parameters.find(
      ({ Name }) => Name === secretParameterName(variable),
    )?.Value,
  }));
}

function parametersFor(part: Part, settings: DeploySettings): Parameter[] {
  if (part === "api") return secretParameters(settings);
  if (part === "email") {
    return emailParametersFrom(
      stackOf(settings, PARTS.api.stack)?.Outputs ?? [],
    );
  }
  return [];
}

function refuseUnlessTheFunctionIsAsDeclared(
  settings: DeploySettings,
  template: string,
  identifier: Record<string, string>,
  parameters: Parameter[],
  account: string,
): void {
  const { Environment } = aws(settings, [
    "lambda",
    "get-function-configuration",
    "--function-name",
    identifier.FunctionName ?? "",
  ]) as { Environment?: { Variables?: Record<string, string> } };
  const declared = declaredEnvironment(
    parseTemplate(template),
    "ApiFunction",
    Object.fromEntries(
      parameters.map(({ ParameterKey, ParameterValue }) => [
        ParameterKey,
        ParameterValue ?? "",
      ]),
    ),
    { account, region: settings.region },
  );
  const different = differentVariables(declared, Environment?.Variables ?? {});
  if (different.length) {
    throw new Error(
      `Refused, nothing was applied: the function's variables are not what infra/api.yaml and SSM declare: ${different.join(", ")}. Make them equal first, or the next change would push the declared ones.`,
    );
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = new Promise<string>((resolve) => {
      rl.on("SIGINT", () => resolve(""));
      void rl.question(question).then(resolve);
    });
    return (await answer).trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

function failureOf(settings: DeploySettings, stack: string): string {
  const { StackEvents } = aws(settings, [
    "cloudformation",
    "describe-stack-events",
    "--stack-name",
    stack,
  ]) as {
    StackEvents: {
      LogicalResourceId: string;
      ResourceType: string;
      ResourceStatus: string;
      ResourceStatusReason?: string;
    }[];
  };
  return StackEvents.filter(({ ResourceStatus }) =>
    ResourceStatus.endsWith("FAILED"),
  )
    .slice(0, 5)
    .map((event) =>
      event.ResourceType === "AWS::Lambda::Function"
        ? `${event.LogicalResourceId}: ${event.ResourceStatus} (its reason can quote the variables: read it in the console)`
        : `${event.LogicalResourceId}: ${event.ResourceStatusReason}`,
    )
    .join("\n  ");
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      import: { type: "boolean", default: false },
      create: { type: "boolean", default: false },
      "overwrite-drift": { type: "boolean", default: false },
    },
  });
  const part = positionals[0] as Part;
  if (positionals.length !== 1 || !(part in PARTS)) {
    throw new Error(
      `Usage: npm run deploy:infra -- <${Object.keys(PARTS).join("|")}> [--import | --create] [--overwrite-drift]`,
    );
  }
  const { stack, template: templateFile } = PARTS[part];
  const adopts = "adopt" in PARTS[part];
  const settings = deploySettings("INFRA_AWS_PROFILE");
  const { Arn, Account: account } = ensureSession(settings);
  console.log(`==> ${part}: stack ${stack}, as ${Arn}`);

  const existing = stackOf(settings, stack);
  let template = readFileSync(path.join(REPO, templateFile), "utf8");
  let type: ChangeSetType;
  let toImport: object[] = [];
  let plan: ImportPlan | undefined;
  if (values.import) {
    if (!adopts) throw new Error(`The ${part} part has nothing to adopt.`);
    if (existing) throw new Error(`${stack} exists already: it was adopted.`);
    plan = JSON.parse(
      readFileSync(path.join(REPO, `infra/import/${part}.json`), "utf8"),
    ) as ImportPlan;
    const types = resourceTypes(template);
    template = importTemplate(
      template,
      Object.keys(plan.resources),
      fillAccount(plan.asItIs ?? {}, account, settings.region),
    );
    toImport = Object.entries(plan.resources).map(
      ([LogicalResourceId, identifier]) => ({
        ResourceType: types[LogicalResourceId],
        LogicalResourceId,
        ResourceIdentifier: fillAccount(identifier, account, settings.region),
      }),
    );
    type = "IMPORT";
  } else if (existing) {
    type = "UPDATE";
  } else if (adopts && !values.create) {
    throw new Error(
      `${stack} does not exist. Where its resources were made by hand, adopt them: npm run deploy:infra -- ${part} --import. In a new, empty account: --create.`,
    );
  } else if (part === "email") {
    throw new Error(
      "The email stack is created by hand the first time (docs/guides/email.md, step 2).",
    );
  } else {
    type = "CREATE";
  }

  const parameters = parametersFor(part, settings);
  const adoptedFunction = plan?.resources.ApiFunction;
  if (adoptedFunction) {
    refuseUnlessTheFunctionIsAsDeclared(
      settings,
      template,
      adoptedFunction,
      parameters,
      account,
    );
  }
  if (type === "UPDATE") {
    const { drifted } = await detectDrift(settings, stack);
    if (drifted.length && !values["overwrite-drift"]) {
      throw new Error(
        `Refused, nothing was applied: ${stack} was changed outside this command, and this deploy could put the template's values back:\n  ${drifted.join("\n  ")}\nWrite the change into the template, or undo it in the console. --overwrite-drift deploys anyway.`,
      );
    }
  }

  const changeSet = `${stack}-${Date.now()}`;
  const target = ["--stack-name", stack, "--change-set-name", changeSet];
  awsWithInput(settings, ["cloudformation", "create-change-set"], {
    StackName: stack,
    ChangeSetName: changeSet,
    ChangeSetType: type,
    TemplateBody: template,
    Parameters: parameters,
    Capabilities: ["CAPABILITY_NAMED_IAM"],
    ...(type === "IMPORT" ? { ResourcesToImport: toImport } : {}),
  });
  const discard = (): void => {
    aws(settings, ["cloudformation", "delete-change-set", ...target]);
    if (type === "UPDATE") return;
    const { Stacks } = aws(settings, [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      stack,
    ]) as { Stacks: Stack[] };
    if (Stacks[0]?.StackStatus === "REVIEW_IN_PROGRESS") {
      aws(settings, ["cloudformation", "delete-stack", "--stack-name", stack]);
    }
  };
  const interrupted = (): void => {
    discard();
    process.exit(130);
  };
  process.once("SIGINT", interrupted);

  try {
    aws(settings, [
      "cloudformation",
      "wait",
      "change-set-create-complete",
      ...target,
    ]);
  } catch {
    const { StatusReason } = aws(settings, [
      "cloudformation",
      "describe-change-set",
      ...target,
    ]) as { StatusReason?: string };
    discard();
    if (isNoChange(StatusReason)) {
      console.log(
        "==> Nothing to deploy: the template and its parameters are those of the last deploy. npm run infra:check compares them with the account.",
      );
      return;
    }
    throw new Error(`The change set failed: ${StatusReason}`);
  }

  const { Changes } = aws(settings, [
    "cloudformation",
    "describe-change-set",
    ...target,
  ]) as { Changes: { ResourceChange: ResourceChange }[] };
  const changes = Changes.map(({ ResourceChange }) => ResourceChange);
  console.log(`==> ${type} change set for ${stack}:`);
  for (const change of changes) console.log(`    ${describeChange(change)}`);
  const blocked = blockers(changes, type);
  if (blocked.length) {
    discard();
    throw new Error(`Refused, nothing was applied:\n  ${blocked.join("\n  ")}`);
  }
  if (
    !(await confirm("Apply it? Type yes to apply, anything else to discard: "))
  ) {
    discard();
    console.log("==> Discarded. Nothing changed.");
    return;
  }
  process.removeListener("SIGINT", interrupted);
  aws(settings, ["cloudformation", "execute-change-set", ...target]);
  const waiter = {
    CREATE: "stack-create-complete",
    UPDATE: "stack-update-complete",
    IMPORT: "stack-import-complete",
  }[type];
  try {
    aws(settings, ["cloudformation", "wait", waiter, "--stack-name", stack]);
  } catch {
    throw new Error(
      `The ${type.toLowerCase()} did not complete:\n  ${failureOf(settings, stack)}`,
    );
  }

  if (adopts) {
    aws(settings, [
      "cloudformation",
      "set-stack-policy",
      "--stack-name",
      stack,
      "--stack-policy-body",
      JSON.stringify(STACK_POLICY),
    ]);
    aws(settings, [
      "cloudformation",
      "update-termination-protection",
      "--enable-termination-protection",
      "--stack-name",
      stack,
    ]);
  }
  if (type === "IMPORT") {
    const { drifted } = await detectDrift(settings, stack);
    if (drifted.length) {
      throw new Error(
        `Adopted, but infra/import/${part}.json does not describe the account as it is; fix it before the next deploy of ${part}:\n  ${drifted.join("\n  ")}`,
      );
    }
  }
  console.log(
    `==> Done: ${stack} is ${stackOf(settings, stack)?.StackStatus}.`,
  );
}

main().catch((err: Error) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
