export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "subject-case": [2, "never", ["sentence-case", "start-case", "pascal-case", "upper-case"]],
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [2, "always", 100],
    "references-empty": [2, "never"],
  },
  parserPreset: {
    parserOpts: {
      // T-nn and H-nn are the owner's list today; the rest are historical and stay parseable.
      issuePrefixes: ["T-", "H-", "W-", "O-F", "O-B", "F-", "P-", "G-"],
    },
  },
};
