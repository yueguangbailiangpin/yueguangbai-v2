## 1. Baseline and Cleanup

- [x] 1.1 Run every workspace typecheck with `noUnusedLocals` and `noUnusedParameters` and record the exact findings.
- [x] 1.2 Remove only reported unused Web declarations and test imports.
- [x] 1.3 Remove only reported unused API declarations, parameters, and test imports.
- [x] 1.4 Confirm contracts, domain, testkit, and UI remain clean.

## 2. Enforcement and Validation

- [x] 2.1 Enable both compiler options in the shared TypeScript configuration only after all workspaces pass.
- [x] 2.2 Run workspace typechecks, focused affected tests, full tests/build, and strict OpenSpec validation.
- [x] 2.3 Confirm no dependency, runtime behavior, API, Migration, permission, or external-resource change.
