# Prompts Index

Reusable AI agent prompts for common tasks in this project.

## Available Prompts

| Prompt                    | File                                 | When to Use                                                  | Expected Input                    | Expected Output                                                         |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------------------- |
| **Scan for Improvements** | `docs/prompts/scan-improvements.md`  | Technical debt audit, code review, before major releases     | Point agent at project root       | Structured Markdown report with issues, violations, and recommendations |
| **Add a New Feature**     | `docs/prompts/add-feature.md`        | Implementing new functionality                               | Feature description in plain text | New files created, existing files modified, docs updated                |
| **Q&A and Docs Update**   | `docs/prompts/qa-and-docs-update.md` | Answering questions about the codebase while fixing doc gaps | A specific question               | Answer with file references, plus updated documentation                 |
| **Fix Audit Issues**      | `docs/prompts/fix-audit-issues.md`   | Fixing specific problems from a technical audit report       | Issue IDs from AUDIT_REPORT.md    | Fixed code, updated tests, modified file summary per issue              |

## How to Use

1. Open the prompt file
2. Copy the prompt text from the `## Prompt` section
3. Fill in any placeholders (e.g., `[FEATURE DESCRIPTION]`, `[YOUR QUESTION]`)
4. Paste into your AI agent (GitHub Copilot, Cursor, Claude, etc.)
5. Ensure the agent has access to the project workspace

## Pre-Requisites

All prompts require the agent to read `docs/agent-context.md` and `docs/_index.json` first. This is specified in each prompt's instructions.
