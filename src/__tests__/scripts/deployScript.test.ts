import { readFileSync } from "fs";
import { join } from "path";

const script = readFileSync(
  join(__dirname, "../../../scripts/deploy-lambda.sh"),
  "utf8",
);

describe("deploy-lambda.sh", () => {
  it("keeps the development email settings of .env out of the production index step", () => {
    const step = script
      .split("\n")
      .find((line) => line.includes("npm run db:sync-indexes"));
    expect(step).toMatch(/EMAIL_PROVIDERS=""/);
    expect(step).toMatch(/APP_URL="https:\/\//);
    expect(step).toMatch(/NODE_ENV=production/);
  });
});
