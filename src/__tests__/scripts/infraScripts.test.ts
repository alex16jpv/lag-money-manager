import {
  blockers,
  describeChange,
  fillAccount,
  importTemplate,
  isNoChange,
  type ResourceChange,
  resourceTypes,
  STACK_POLICY,
} from "../../../scripts/infra/changeSet";
import { readDrifts } from "../../../scripts/infra/drift";
import { undeclared } from "../../../scripts/infra/inventory";
import {
  declaredEnvironment,
  differentVariables,
  parseTemplate,
} from "../../../scripts/infra/template";

const change = (overrides: Partial<ResourceChange>): ResourceChange => ({
  Action: "Modify",
  LogicalResourceId: "ApiFunction",
  ResourceType: "AWS::Lambda::Function",
  Replacement: "False",
  ...overrides,
});

describe("deploy:infra's change set", () => {
  it("lets an update that only modifies in place through", () => {
    expect(
      blockers(
        [change({}), change({ Action: "Add", Replacement: undefined })],
        "UPDATE",
      ),
    ).toEqual([]);
  });

  it("refuses to remove or replace anything, or to risk a replacement", () => {
    expect(
      blockers(
        [
          change({
            Action: "Remove",
            LogicalResourceId: "KeepaliveRule",
            ResourceType: "AWS::Events::Rule",
          }),
          change({
            Replacement: "True",
            LogicalResourceId: "ApiRole",
            ResourceType: "AWS::IAM::Role",
          }),
          change({
            Replacement: "Conditional",
            LogicalResourceId: "ApiUrl",
            ResourceType: "AWS::Lambda::Url",
          }),
        ],
        "UPDATE",
      ),
    ).toEqual([
      "KeepaliveRule (AWS::Events::Rule) would be removed",
      "ApiRole (AWS::IAM::Role) would be replaced",
      "ApiUrl (AWS::Lambda::Url) might be replaced",
    ]);
  });

  it("refuses to touch the function's code, which only deploy:lambda uploads", () => {
    expect(
      blockers(
        [
          change({
            Details: [{ Target: { Attribute: "Properties", Name: "Code" } }],
          }),
        ],
        "UPDATE",
      ),
    ).toEqual([
      "ApiFunction (AWS::Lambda::Function) would get the template's placeholder over the code npm run deploy:lambda uploaded",
    ]);
  });

  it("lets an import only adopt", () => {
    expect(blockers([change({ Action: "Import" })], "IMPORT")).toEqual([]);
    expect(blockers([change({ Action: "Add" })], "IMPORT")).toEqual([
      "ApiFunction (AWS::Lambda::Function): an import may only adopt resources, not Add",
    ]);
  });

  it("names what changes, never its value", () => {
    const line = describeChange(
      change({
        Details: [
          { Target: { Attribute: "Properties", Name: "Environment" } },
          { Target: { Attribute: "Properties", Name: "Environment" } },
          { Target: { Attribute: "Tags" } },
        ],
      }),
    );
    expect(line).toBe(
      "Modify  ApiFunction (AWS::Lambda::Function): Environment, Tags",
    );
  });
});

describe("the template of an import", () => {
  const template = [
    "Parameters:",
    "  Name: { Type: String }",
    "Resources:",
    "  Kept:",
    "    Type: AWS::Logs::LogGroup",
    "    Properties:",
    "      LogGroupName: !Sub /aws/lambda/${Name}",
    "  New:",
    "    Type: AWS::IAM::UserPolicy",
    "Outputs:",
    "  Out: { Value: !Ref Kept }",
    "",
  ].join("\n");

  it("keeps only what is adopted, and no outputs, with its tags intact", () => {
    const out = importTemplate(template, ["Kept"]);
    expect(out).toContain("Kept:");
    expect(out).toContain("!Sub /aws/lambda/${Name}");
    expect(out).not.toContain("New:");
    expect(out).not.toContain("Outputs");
  });

  it("describes an adopted resource as it is today when asked to", () => {
    const out = importTemplate(template, ["Kept"], {
      Kept: { LogGroupName: "/aws/lambda/api" },
    });
    expect(out).toContain(`LogGroupName: "/aws/lambda/api"`);
    expect(out).not.toContain("!Sub");
    expect(() => importTemplate(template, ["Kept"], { New: {} })).toThrow(
      "Not adopted: New",
    );
  });

  it("reads each resource's type", () => {
    expect(resourceTypes(template)).toEqual({
      Kept: "AWS::Logs::LogGroup",
      New: "AWS::IAM::UserPolicy",
    });
  });

  it("refuses to adopt a resource the template does not declare", () => {
    expect(() => importTemplate(template, ["Kept", "Missing"])).toThrow(
      "Not in the template: Missing",
    );
  });

  it("fills the account and the region in, however deep", () => {
    expect(
      fillAccount(
        {
          Arn: "arn:aws:events:{region}:{account}:rule/r",
          Name: "r",
          Statement: [{ Resource: "arn:aws:iam::{account}:policy/p" }],
        },
        "123456789012",
        "us-east-1",
      ),
    ).toEqual({
      Arn: "arn:aws:events:us-east-1:123456789012:rule/r",
      Name: "r",
      Statement: [{ Resource: "arn:aws:iam::123456789012:policy/p" }],
    });
  });
});

describe("infra:check's inventory", () => {
  it("finds what no stack declares, whether stacks name it by name or by ARN", () => {
    expect(
      undeclared(
        [
          "ledgerflow",
          "/aws/lambda/ledgerflow",
          "arn:aws:sns:us-east-1:1:alerts",
          "stray",
          "ledgerflow-old",
        ],
        [
          "ledgerflow",
          "/aws/lambda/ledgerflow",
          "arn:aws:sns:us-east-1:1:alerts",
        ],
      ),
    ).toEqual(["stray", "ledgerflow-old"]);
    expect(
      undeclared(["keepalive"], ["arn:aws:events:us-east-1:1:rule/keepalive"]),
    ).toEqual([]);
    expect(undeclared(["Sid1", "Sid2"], ["ledgerflow|Sid1"])).toEqual(["Sid2"]);
  });
});

describe("deploy:infra's guards beyond the change set", () => {
  it("tells a change set with nothing to do from one that failed", () => {
    expect(
      isNoChange(
        "The submitted information didn't contain changes. Submit different information to create a change set.",
      ),
    ).toBe(true);
    expect(isNoChange("No updates are to be performed.")).toBe(true);
    expect(isNoChange("Resource handler returned message: AccessDenied")).toBe(
      false,
    );
    expect(isNoChange(undefined)).toBe(false);
  });

  it("asks AWS itself to refuse removing or replacing anything in the stack", () => {
    expect(STACK_POLICY.Statement).toContainEqual(
      expect.objectContaining({
        Effect: "Deny",
        Action: ["Update:Replace", "Update:Delete"],
        Resource: "*",
      }),
    );
  });

  const template = parseTemplate(
    [
      "Resources:",
      "  Fn:",
      "    Type: AWS::Lambda::Function",
      "    Properties:",
      "      Environment:",
      "        Variables:",
      "          PLAIN: x",
      "          SECRET: !Ref Secret",
      "          TOPIC: !Sub arn:${AWS::Partition}:sns:${AWS::Region}:${AWS::AccountId}:t",
      "",
    ].join("\n"),
  );
  const where = { account: "123456789012", region: "us-east-1" };

  it("resolves what the function declares, secrets and account included", () => {
    expect(declaredEnvironment(template, "Fn", { Secret: "s" }, where)).toEqual(
      {
        PLAIN: "x",
        SECRET: "s",
        TOPIC: "arn:aws:sns:us-east-1:123456789012:t",
      },
    );
    expect(() => declaredEnvironment(template, "Fn", {}, where)).toThrow(
      "SECRET: no value for Secret",
    );
  });

  it("names the variables that differ, are missing or are extra, never their values", () => {
    expect(
      differentVariables(
        { A: "1", B: "2", C: "3" },
        { A: "1", B: "two", D: "4" },
      ),
    ).toEqual(["B", "C", "D"]);
    expect(differentVariables({ A: "1" }, { A: "1" })).toEqual([]);
  });
});

describe("drift", () => {
  it("names what drifted and how, and what CloudFormation could not compare", () => {
    expect(
      readDrifts([
        {
          LogicalResourceId: "ApiFunction",
          ResourceType: "AWS::Lambda::Function",
          StackResourceDriftStatus: "MODIFIED",
          PropertyDifferences: [
            {
              PropertyPath: "/Environment/Variables/EMAIL_SENDING_ENABLED",
              DifferenceType: "ADD",
            },
          ],
        },
        {
          LogicalResourceId: "KeepaliveRule",
          ResourceType: "AWS::Events::Rule",
          StackResourceDriftStatus: "DELETED",
        },
        {
          LogicalResourceId: "ApiUrl",
          ResourceType: "AWS::Lambda::Url",
          StackResourceDriftStatus: "NOT_CHECKED",
        },
        {
          LogicalResourceId: "ApiRole",
          ResourceType: "AWS::IAM::Role",
          StackResourceDriftStatus: "IN_SYNC",
        },
      ]),
    ).toEqual({
      drifted: [
        "ApiFunction (AWS::Lambda::Function) modified: /Environment/Variables/EMAIL_SENDING_ENABLED add",
        "KeepaliveRule (AWS::Events::Rule) deleted",
      ],
      notCompared: ["ApiUrl (AWS::Lambda::Url)"],
    });
  });
});
