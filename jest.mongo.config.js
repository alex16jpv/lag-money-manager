/**
 * The suite that needs a real mongod: parity fixtures and the offline write
 * paths (O-B6). Kept out of `npm test` — and so out of `npm run ci` — because
 * CI has no database; `npm run test:mongo` runs it against a local one.
 *
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/mongo/*.mongo.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  setupFiles: ["<rootDir>/src/__tests__/mongo/env.setup.ts"],
  // One database, one writer: these files drop and rebuild it.
  maxWorkers: 1,
  // Same as `npm test`: supertest and the driver keep handles open past the
  // last assertion, and a hung runner reads as a hung suite.
  forceExit: true,
  testTimeout: 120_000,
  transformIgnorePatterns: ["/node_modules/(?!uuid/)"],
  transform: {
    "^.+\\.[jt]s$": [
      "ts-jest",
      { diagnostics: false, tsconfig: { allowJs: true } },
    ],
  },
};
