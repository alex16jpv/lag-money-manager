import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const REQUESTS_DIR = join(__dirname, "../../../requests");

// A REST Client file variable must not share its name with the request it
// captures from: `@accA = {{accA.response.body.id}}` is self-referential, so
// {{accA}} resolves to the variable instead of the captured id and the value
// silently arrives empty. That cost an afternoon of chasing a phantom
// "fromAccountId must be a valid UUID".
const CAPTURE = /^@([A-Za-z_]\w*)\s*=\s*\{\{([A-Za-z_]\w*)\.response\./gm;

describe("requests/*.http fixtures", () => {
  const files = readdirSync(REQUESTS_DIR).filter((f) => f.endsWith(".http"));

  it("has fixture files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s: no capture variable shadows its request name", (file) => {
    const body = readFileSync(join(REQUESTS_DIR, file), "utf8");
    const collisions = [...body.matchAll(CAPTURE)]
      .filter(([, variable, request]) => variable === request)
      .map(([, variable]) => variable);

    expect(collisions).toEqual([]);
  });

  it.each(files)("%s: every referenced capture variable is defined", (file) => {
    const body = readFileSync(join(REQUESTS_DIR, file), "utf8");
    const defined = new Set(
      [...body.matchAll(/^@([A-Za-z_]\w*)\s*=/gm)].map(([, name]) => name),
    );
    const referenced = [...body.matchAll(/\{\{([A-Za-z_]\w*)\}\}/g)].map(
      ([, name]) => name,
    );

    const undefinedRefs = [...new Set(referenced)].filter(
      (name) => !defined.has(name),
    );
    expect(undefinedRefs).toEqual([]);
  });
});
