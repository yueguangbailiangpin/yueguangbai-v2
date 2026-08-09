## Context

All workspaces extend one strict base TypeScript configuration. No new lint dependency is needed because TypeScript already implements both checks.

## Goals / Non-Goals

**Goals:** remove compiler-proven dead declarations and keep the repository clean through normal typecheck.

**Non-Goals:** no stylistic lint expansion, public API redesign, runtime refactor, or dependency addition.

## Decisions

- Run each workspace with both flags before editing, remove only reported dead code, and rerun until all workspaces pass.
- Put the flags in `tsconfig.base.json` so the existing workspace typechecks enforce one policy.
- Preserve parameters whose names or shapes are contractually required; use the established underscore convention only where TypeScript treats a required parameter as intentionally unused.

## Risks / Trade-offs

- [A declaration is used through a subtle side effect] → Remove only imports/declarations proven unused by TypeScript and run full tests/build.

## Migration Plan

No runtime or data migration. Revert the source cleanup and two compiler flags together if a compatibility issue appears.
