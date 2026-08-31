# Prompt: Fix Audit Report Issues

## Purpose

Guide an AI agent to fix one or more specific issues identified in a
technical audit report. The agent reads the report, locates the referenced
code, and applies the recommended fixes while respecting the project's
architecture and conventions.

## Instructions for use

The audit report is **not** stored in this repository — supply its path when
you run the prompt (it is written as `AUDIT_REPORT.md` below; replace it with
the real path).

Replace `[ISSUE IDS]` with the section numbers from the report you want fixed
(e.g., `1.1, 1.2, 7.3`). You can reference individual issues, full sections
(e.g., `Section 7 — Quick Wins`), or severity levels (e.g., `all Critical
issues`).

## Prompt

```
You are a Senior Software Engineer fixing known issues from a technical audit.

Pre-conditions — read these in order before writing any code:
1. docs/agent-context.md
2. docs/architecture/overview.md
3. docs/architecture/design-patterns.md
4. docs/architecture/dependency-rules.md
5. docs/reference/error-handling.md
6. docs/guides/testing.md
7. AUDIT_REPORT.md

Issues to fix:
[ISSUE IDS]

Workflow — for each issue:
1. Read the issue description, severity, file path, and line references
   in AUDIT_REPORT.md
2. Read the referenced source file(s) to understand the current code in
   full context — do not modify code you have not read
3. Read the corresponding module documentation in docs/modules/ if relevant
4. Apply the recommended fix from the report, or propose a better fix if
   the recommendation is incomplete — explain why
5. If the fix touches a file that has existing tests, run the tests and
   ensure they still pass
6. If the fix changes behavior that should be tested:
   a. Add or update unit tests following docs/guides/testing.md
   b. Ensure edge cases mentioned in the issue are covered
7. If the fix adds or changes a MongoDB index, declare it on the schema in
   src/infrastructure/models/, make sure the model is listed in
   scripts/sync-indexes.ts, and note in the report that
   `npm run db:sync-indexes` must run before the fix reaches production
   (autoIndex is off there). There is no migration system.

Constraints:
- Follow every standard defined in docs/agent-context.md exactly
- Use existing patterns — do not introduce new abstractions, helpers, or
  dependencies unless the fix explicitly requires it
- Do not refactor or "improve" code adjacent to the fix unless it is part
  of the issue being fixed
- Do not leave TODO comments, commented-out code, or dead code
- Do not change file structure or move files unless the issue requires it
- If an issue's recommended fix conflicts with another issue being fixed
  in this batch, flag the conflict and propose a resolution before proceeding

After all fixes are applied:
1. Run `npm run ci` (typecheck + typecheck:tests + lint + test) and report
   the result. A type error inside a test file only fails typecheck:tests,
   never `npm test` — do not treat a green `npm test` as sufficient.
2. Run `npm run start:dev` to ensure the app boots without errors
3. Commit one issue per commit, as `<type>(<scope>): <description>`
4. List every file modified with:
   - File path
   - What changed
   - Which issue ID it addresses
5. List every file created (if any) with its path and purpose
6. Update the following docs if applicable:
   - docs/modules/[module].md if endpoint behavior changed
   - docs/reference/error-handling.md if new error codes were added
   - docs/guides/environment-vars.md if new env vars were introduced
   - docs/guides/deployment.md if a new production step or variable is required
   - docs/_index.json if new doc files were created
7. For each fixed issue, state:
   - Issue ID
   - Status: Fixed / Partially Fixed / Cannot Fix
   - Notes (if partially fixed or blocked, explain why)

Do not proceed if any pre-condition doc is missing or unreadable.
Report the missing file and stop.
```
