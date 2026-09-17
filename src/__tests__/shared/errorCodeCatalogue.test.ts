/**
 * The error code catalogue is a promise: `docs/reference/error-handling.md`
 * says "anything not listed here has no `code`", and the frontend reads it to
 * know what it has to branch on. Nothing checked it, so eight codes had
 * shipped without a row — found reviewing T-87, which had just added a ninth.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { ERROR_CODES } from "../../shared/errorCodes";

const CATALOGUE = join(__dirname, "../../../docs/reference/error-handling.md");

const documented = (): string[] => {
  const doc = readFileSync(CATALOGUE, "utf8");
  const rows = doc.matchAll(/^\| `([A-Z_]+)`\s*\|/gm);
  return [...rows].map((row) => row[1] as string);
};

describe("error code catalogue", () => {
  it("documents every code the API can raise", () => {
    const listed = new Set(documented());
    expect(ERROR_CODES.filter((code) => !listed.has(code))).toEqual([]);
  });

  it("documents no code the API cannot raise", () => {
    const raised = new Set<string>(ERROR_CODES);
    expect(documented().filter((code) => !raised.has(code))).toEqual([]);
  });
});
