/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  // The mongod-backed suite runs on its own config (`npm run test:mongo`): it
  // needs a database, and `npm run ci` has to pass without one.
  testPathIgnorePatterns: ["/node_modules/", "\\.mongo\\.test\\.ts$"],
  moduleFileExtensions: ["ts", "js", "json"],
  clearMocks: true,
  transformIgnorePatterns: ["/node_modules/(?!uuid/)"],
  transform: {
    "^.+\\.[jt]s$": [
      "ts-jest",
      { diagnostics: false, tsconfig: { allowJs: true } },
    ],
  },
};
