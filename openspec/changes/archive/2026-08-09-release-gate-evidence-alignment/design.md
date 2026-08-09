## Context

The repository has 38 continuous migrations and archived production-preparation Changes. Existing local preflights intentionally validate disabled templates and do not prove provider activation. Release evidence must remain executable after Change archival and after later requirements are appended.

## Goals / Non-Goals

**Goals:**

- Fail closed on missing, duplicated, or coexisting active/archive evidence.
- Run one explicit local release command against a clean candidate commit.
- Preserve external blockers and label laboratory performance data accurately.

**Non-Goals:**

- No deployment, online Migration, real provider call, secret read, or external write.
- No conversion of templates, mocks, dry-runs, or preflights into production completion.

## Decisions

- Use one standard-library verifier utility for repository reads, assertions, and active/archive resolution; it rejects duplicate or ambiguous evidence.
- Map the five Staff MCP security invariants by exact requirement name and implementation/test markers, while allowing additional authoritative requirements.
- Implement the aggregate gate as a small Node runner so command order, candidate provenance, failures, and the final `PRODUCTION_NO_GO` conclusion are explicit.
- Require a clean tracked candidate and report `HEAD` plus `HEAD^{tree}` dynamically; no historical SHA is embedded as the current release candidate.
- Reuse existing local commands and their fail-closed templates rather than adding provider-specific logic.

## Risks / Trade-offs

- [Aggregate gate is long] → Keep it release-only and reuse existing scripts instead of duplicating checks.
- [Archived historical files retain old facts] → Current acceptance/runbook language identifies them as historical rather than rewriting history.
- [Local timings vary by machine] → Report median laboratory data and explicitly omit production LCP/INP/CLS claims.

## Migration Plan

No schema or deployment migration. Revert the package command, release runner, verifier utility adoption, and current documents together.
