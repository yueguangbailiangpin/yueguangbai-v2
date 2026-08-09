## Why

TypeScript currently reports a small, finite set of unused locals, parameters, and test imports only when stricter flags are supplied manually. Cleaning them and enabling the compiler flags prevents dead code from accumulating without adding lint tooling.

## What Changes

- Remove only compiler-proven unused imports, locals, and parameters.
- Enable `noUnusedLocals` and `noUnusedParameters` for all workspace typechecks only after every workspace is clean.
- Add no dependency or runtime behavior.

## Capabilities

No capability requirement changes. This is compiler/tooling hygiene, so this Change sets `skip_specs: true`.

## Impact

TypeScript sources/tests and shared compiler configuration. No API, UI behavior, data, permission, session, Migration, or external system changes.
