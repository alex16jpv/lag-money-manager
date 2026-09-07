/**
 * The committed parity contract (`fixtures/offline/`) must be exactly what the
 * generator produces from the scenarios: a rule that changes in
 * `scripts/offline-fixtures/` without a rebuild would leave the two repos
 * agreeing on stale figures. `npm run fixtures:check` is this same comparison
 * for the command line; here it runs inside `npm test`, with no database.
 */
import {
  buildFixtureFiles,
  driftAgainst,
  OUT_DIR,
} from "../../../scripts/offline-fixtures/build";

describe("offline parity fixtures", () => {
  const { fixtures, files } = buildFixtureFiles();

  it("commits exactly what the generator builds", () => {
    expect(driftAgainst(OUT_DIR, files)).toEqual([]);
  });

  it("covers the four scenarios the frontend vendors", () => {
    expect(fixtures.map((f) => f.id)).toEqual([
      "cop-bogota",
      "eur-madrid",
      "jpy-tokyo",
      "usd-new-york",
    ]);
  });

  // The one figure of the four scenarios a running float sum gets wrong, so
  // the rule the README states is anchored to something that fails.
  it("pins a balance that floats cannot add", () => {
    const madrid = fixtures.find((f) => f.id === "eur-madrid");
    const current = madrid?.expected.balances.find((b) => b.key === "current");
    expect(current?.balance).toBe(2378.68);
    expect(1000 - 10.1 + 1500 - 7.77 - 100 - 3.45).not.toBe(2378.68);
  });
});
