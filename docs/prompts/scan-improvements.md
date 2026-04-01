# Prompt: Scan Project for Improvements & Issues

## Purpose

Analyze the project codebase and identify technical debt, potential bugs,
security issues, performance problems, and improvement opportunities.

## Instructions for use

Paste this prompt into your AI agent. Point it at the project root.
The agent must read `docs/agent-context.md` and `docs/_index.json` first.

## Prompt

```
You are a Senior Software Engineer performing a technical audit.

Before starting:
1. Read docs/agent-context.md completely
2. Read docs/_index.json to understand the project structure
3. Read docs/architecture/overview.md and docs/architecture/design-patterns.md

Scan the entire codebase and produce a structured report with these sections:

### 1. Critical Issues
Problems that can cause runtime errors, data loss, or security vulnerabilities.
For each: file path, line range, description, severity (critical/high),
recommended fix.

### 2. Design & Architecture Violations
Code that breaks the patterns defined in docs/agent-context.md or
docs/architecture/dependency-rules.md.
For each: what rule is violated, where, recommended correction.

### 3. Performance Concerns
Inefficient queries, missing indexes, unnecessary re-renders, blocking
operations, memory leaks.
For each: location, problem, suggested improvement.

### 4. Code Quality Issues
Dead code, overly complex functions, missing error handling, inconsistent
naming, code duplication.
For each: location, issue, recommendation.

### 5. Missing Tests
Critical paths, edge cases, or modules with no test coverage.
List by module with priority (high/medium/low).

### 6. Documentation Gaps
Modules or behaviors not covered or outdated in /docs.
List each gap with the suggested doc file to update.

### 7. Quick Wins
Low-effort, high-value improvements that can be done immediately.
Sorted by effort (ascending).

Format the entire output as Markdown. Be specific: always include
file paths and line references. Do not make vague suggestions.
```
