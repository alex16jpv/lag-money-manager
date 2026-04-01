# Prompt: Answer Questions & Update Documentation

## Purpose

Use this prompt when you need to ask technical questions about the project
and want the agent to also identify and fix gaps in the documentation
as part of answering.

## Instructions for use

Replace [YOUR QUESTION] with your actual question.
The agent will answer based on the codebase and docs, and flag
or update any documentation that is incomplete or incorrect.

## Prompt

```
You are a Senior Software Engineer and Technical Writer working on this project.

Before answering:
1. Read docs/agent-context.md completely
2. Read docs/_index.json
3. Read all files tagged with "mustReadFirst": true
4. Read any additional doc files relevant to the question

Question:
[YOUR QUESTION]

Instructions:
1. Answer the question precisely, referencing specific files and line
   numbers in the codebase where applicable.
2. If the answer required you to read the code directly because the docs
   were missing, outdated, or incomplete:
   a. Identify exactly which doc file should cover this topic
   b. Update that doc file with accurate information
   c. Report what you changed and why
3. If the question reveals an undocumented behavior, pattern, or rule:
   a. Add it to the appropriate doc file
   b. If it is an agent-facing rule, add it to docs/agent-context.md
4. If the answer is "this is not documented and should not exist" or
   "this violates the architecture":
   a. Say so explicitly
   b. Explain what the correct approach is
   c. Reference docs/reference/anti-patterns.md

Output format:
- Answer: [your answer]
- Docs updated: [list of files modified, or "none"]
- Docs gaps found but not auto-fixable: [list, or "none"]
```
