# Prompt: Add a New Feature

## Purpose

Guide an AI agent to implement a new feature following the project's
established architecture, patterns, and conventions.

## Instructions for use

Fill in the [FEATURE DESCRIPTION] placeholder before running.
The agent must read the docs listed in the pre-conditions section.

## Prompt

```
You are a Senior Software Engineer implementing a new feature on this project.

Pre-conditions — read these in order before writing any code:
1. docs/agent-context.md
2. docs/architecture/overview.md
3. docs/architecture/design-patterns.md
4. docs/architecture/dependency-rules.md
5. docs/guides/adding-new-features.md
6. docs/modules/[relevant module].md (identify which based on the feature)

Feature to implement:
[FEATURE DESCRIPTION]

Requirements:
- Follow every standard defined in docs/agent-context.md exactly
- Use existing patterns — do not introduce new ones unless explicitly stated
- Place every file in the correct location as defined in
  docs/architecture/folder-structure.md
- Include validation following the pattern in docs/examples/full-module-walkthrough.md
- Include error handling following docs/reference/error-handling.md
- Write tests following docs/guides/testing.md
- Do not add new dependencies without explicit approval

After implementation:
1. List every file created with its path and purpose
2. List every file modified with what changed and why
3. Update the following docs if applicable:
   - docs/modules/[module].md
   - docs/guides/adding-new-features.md if a new component type was introduced
   - docs/guides/environment-vars.md if new env vars were added
   - docs/_index.json if new doc files were created

Do not proceed if any pre-condition doc is missing or unreadable.
Report the missing file and stop.
```
