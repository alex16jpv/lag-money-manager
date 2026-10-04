import { parse, type Tags, type YAMLMap, type YAMLSeq } from "yaml";

const intrinsic = (tag: string, fn: string): Tags => {
  const collection = (
    value: YAMLMap.Parsed | YAMLSeq.Parsed,
  ): Record<string, unknown> => ({ [fn]: value.toJSON() });
  return [
    { tag: `!${tag}`, resolve: (value: string) => ({ [fn]: value }) },
    { tag: `!${tag}`, collection: "seq", resolve: collection },
    { tag: `!${tag}`, collection: "map", resolve: collection },
  ];
};

export type Resource = {
  Type: string;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
  Condition?: string;
  Properties: Record<string, unknown>;
};

export type Template = {
  Parameters: Record<
    string,
    {
      Default?: string | number;
      AllowedPattern?: string;
      AllowedValues?: (string | number)[];
      NoEcho?: boolean;
    }
  >;
  Resources: Record<string, Resource>;
  Outputs?: Record<string, { Value: unknown }>;
};

export function parseTemplate(text: string): Template {
  return parse(text, {
    customTags: [
      ...intrinsic("Ref", "Ref"),
      ...intrinsic("Sub", "Fn::Sub"),
      ...intrinsic("GetAtt", "Fn::GetAtt"),
      ...intrinsic("If", "Fn::If"),
      ...intrinsic("Not", "Fn::Not"),
      ...intrinsic("Equals", "Fn::Equals"),
    ],
  }) as Template;
}

export type Account = { account: string; region: string };

export function declaredEnvironment(
  template: Template,
  resource: string,
  parameters: Record<string, string>,
  { account, region }: Account,
): Record<string, string> {
  const variables = (
    template.Resources[resource]?.Properties.Environment as
      { Variables: Record<string, unknown> } | undefined
  )?.Variables;
  if (!variables) throw new Error(`${resource} declares no environment`);
  const resolve = (name: string, value: unknown): string => {
    if (typeof value === "string") return value;
    const { Ref, "Fn::Sub": sub } = value as {
      Ref?: string;
      "Fn::Sub"?: string;
    };
    if (Ref !== undefined) {
      const resolved = parameters[Ref];
      if (resolved === undefined)
        throw new Error(`${name}: no value for ${Ref}`);
      return resolved;
    }
    if (typeof sub === "string" && !/\$\{(?!AWS::)/.test(sub)) {
      return sub
        .split("${AWS::Partition}")
        .join("aws")
        .split("${AWS::Region}")
        .join(region)
        .split("${AWS::AccountId}")
        .join(account);
    }
    throw new Error(`${name}: cannot resolve ${JSON.stringify(value)}`);
  };
  return Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [
      name,
      resolve(name, value),
    ]),
  );
}

export function differentVariables(
  declared: Record<string, string>,
  live: Record<string, string>,
): string[] {
  const names = [...new Set([...Object.keys(declared), ...Object.keys(live)])];
  return names.filter((name) => declared[name] !== live[name]).sort();
}
