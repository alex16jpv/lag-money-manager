import { readFileSync } from "fs";
import path from "path";

import { parseTemplate, type Template } from "../../../scripts/infra/template";

export type { Resource, Template } from "../../../scripts/infra/template";

export const REPO = path.resolve(__dirname, "../../..");

export function loadTemplate(file: string): Template {
  return parseTemplate(readFileSync(path.join(REPO, file), "utf8"));
}
