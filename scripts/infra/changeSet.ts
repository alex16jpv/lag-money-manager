import { parseDocument } from "yaml";

export type ChangeSetType = "CREATE" | "UPDATE" | "IMPORT";

export type ResourceChange = {
  Action: string;
  LogicalResourceId: string;
  ResourceType: string;
  Replacement?: string;
  Details?: {
    Target?: { Attribute?: string; Name?: string; RequiresRecreation?: string };
  }[];
};

export function blockers(
  changes: ResourceChange[],
  type: ChangeSetType,
): string[] {
  return changes.flatMap((change) => {
    const name = `${change.LogicalResourceId} (${change.ResourceType})`;
    if (type === "IMPORT" && change.Action !== "Import") {
      return [
        `${name}: an import may only adopt resources, not ${change.Action}`,
      ];
    }
    if (change.Action === "Remove") return [`${name} would be removed`];
    const touchesCode = (change.Details ?? []).some(
      ({ Target }) => Target?.Name === "Code",
    );
    if (change.ResourceType === "AWS::Lambda::Function" && touchesCode) {
      return [
        `${name} would get the template's placeholder over the code npm run deploy:lambda uploaded`,
      ];
    }
    if (change.Replacement === "True") return [`${name} would be replaced`];
    if (change.Replacement === "Conditional") {
      return [`${name} might be replaced`];
    }
    return [];
  });
}

export function describeChange(change: ResourceChange): string {
  const changed = (change.Details ?? [])
    .map(({ Target }) => Target?.Name ?? Target?.Attribute)
    .filter((name): name is string => Boolean(name));
  const what = changed.length ? `: ${[...new Set(changed)].join(", ")}` : "";
  return `${change.Action.padEnd(7)} ${change.LogicalResourceId} (${change.ResourceType})${what}`;
}

export function importTemplate(
  template: string,
  adopted: string[],
  asItIs: Record<string, Record<string, unknown>> = {},
): string {
  const doc = parseDocument(template);
  const resources = doc.get("Resources") as { items: { key: unknown }[] };
  const declared = resources.items.map(({ key }) => String(key));
  const unknown = adopted.filter((id) => !declared.includes(id));
  if (unknown.length) {
    throw new Error(`Not in the template: ${unknown.join(", ")}`);
  }
  for (const id of declared) {
    if (!adopted.includes(id)) doc.deleteIn(["Resources", id]);
  }
  for (const [id, properties] of Object.entries(asItIs)) {
    if (!adopted.includes(id)) throw new Error(`Not adopted: ${id}`);
    doc.setIn(["Resources", id, "Properties"], doc.createNode(properties));
  }
  doc.delete("Outputs");
  return doc.toString({
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
  });
}

export function resourceTypes(template: string): Record<string, string> {
  const resources = parseDocument(template).get("Resources") as {
    items: { key: unknown; value: { get: (key: string) => unknown } }[];
  };
  return Object.fromEntries(
    resources.items.map(({ key, value }) => [
      String(key),
      String(value.get("Type")),
    ]),
  );
}

export function fillAccount<T>(value: T, account: string, region: string): T {
  return JSON.parse(
    JSON.stringify(value)
      .split("{account}")
      .join(account)
      .split("{region}")
      .join(region),
  ) as T;
}

export const isNoChange = (reason = ""): boolean =>
  reason.includes("didn't contain changes") || reason.includes("No updates");

export type Parameter = {
  ParameterKey: string;
  ParameterValue?: string;
  UsePreviousValue?: boolean;
};

export function emailParametersFrom(
  apiOutputs: { OutputKey: string; OutputValue: string }[],
): Parameter[] {
  const output = (key: string): string => {
    const value = apiOutputs.find(
      ({ OutputKey }) => OutputKey === key,
    )?.OutputValue;
    if (!value)
      throw new Error(
        `Deploy the api part first: its stack has no ${key} output.`,
      );
    return value;
  };
  return [
    { ParameterKey: "ApiFunctionName", ParameterValue: output("FunctionName") },
    { ParameterKey: "ApiRoleName", ParameterValue: output("RoleName") },
    { ParameterKey: "ApiRolePath", ParameterValue: output("RolePath") },
    {
      ParameterKey: "WebhookUrl",
      ParameterValue: `${output("FunctionUrl")}webhooks/email/ses`,
    },
    { ParameterKey: "AlertEmail", UsePreviousValue: true },
  ];
}

export const STACK_POLICY = {
  Statement: [
    { Effect: "Allow", Action: "Update:Modify", Principal: "*", Resource: "*" },
    {
      Effect: "Deny",
      Action: ["Update:Replace", "Update:Delete"],
      Principal: "*",
      Resource: "*",
    },
  ],
};
