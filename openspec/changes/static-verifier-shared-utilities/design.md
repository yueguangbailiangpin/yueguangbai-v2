## Context

The repository currently has many one-file verifiers created across historical Changes. Several contain near-identical helpers, while some old commands remain valuable for reproducing archived acceptance even when no package script references them.

## Goals / Non-Goals

**Goals:** centralize only exact repeated mechanics, retain assertion strength, and produce traceable retention evidence for historical scripts.

**Non-Goals:** no mass rewrite, heuristic source parsing, deletion by reference count alone, or conversion of security invariants into broad permissive checks.

## Decisions

- The shared utility uses only Node standard library and exposes small functions for workspace-root reads, truth assertions, marker assertions, and exactly-one active/archive resolution.
- Active/archive resolution validates ordinary directories, dated archive names, absence of coexistence/duplicates, and the requested evidence file.
- Exact source markers remain exact where they protect security or contracts; helper extraction removes repeated mechanics, not required markers.
- Historical verifiers are retained when archived Change tasks, acceptance evidence, or manual reproduction value exists. Deletion requires a later independent Change with a reference map and replacement evidence.

## Risks / Trade-offs

- [A shared helper becomes a single weak point] → Keep it small, add deterministic edge-case tests, and preserve caller-specific assertions.
- [Broad migration creates review risk] → Limit adoption to touched and mechanically identical low-risk scripts; report remaining duplication honestly.

## Migration Plan

No production migration. Revert utility adoption and its callers together; retained historical scripts remain available throughout.
