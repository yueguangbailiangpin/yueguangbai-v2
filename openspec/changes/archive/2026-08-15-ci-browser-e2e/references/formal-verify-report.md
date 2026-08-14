# Formal Verify: ci-browser-e2e

Verified on 2026-08-15 Asia/Shanghai against implementation commit
`7a59b3fda24e9730aaeee0fc83b39e0a4cbcc990`, the active proposal, design,
tasks and delta specifications. No staging, production, Cloudflare resource or
real-data operation was performed.

## Evidence mapping

| Concern | Evidence | Result |
| --- | --- | --- |
| Independent browser job | `.github/workflows/ci.yml` defines `browser-e2e` independently from `static-governance` and `tests-and-build`, with Node `24.19.0`, a 30-minute timeout and workflow-level `contents: read` | PASS |
| Install provenance and command boundary | the workflow runs the lifecycle verifier and its Node self-test before `npm ci`; the final-go verifier rejects command, ordering, timeout, permission and action-pin drift | PASS |
| Complete local suite | `npm run test:browser` expands the 13 committed specs to 188 tests against the loopback preview; local execution finished with 187 passed, one intentional environment-gated visual-review skip and zero failures | PASS |
| Failure evidence | the fixed SHA-pinned `actions/upload-artifact` v4.6.2 step runs only after failure, retains evidence for seven days and tolerates absent report directories without hiding the originating failure | PASS |
| Runtime-contract reconciliation | five E2E fixtures and approved copy/label assertions were aligned to current strict contracts without changing business runtime code or loosening a schema | PASS |
| Canonical specifications | the two routing copy deltas were synchronized and the independent browser CI capability was added to the canonical specifications | PASS |
| Repository validation | full Vitest: 253 files / 1670 tests; final-go verifier tests: 25/25; Web typecheck and build, OpenSpec target/all strict and `git diff --check`: PASS | PASS |
| GitHub evidence | PR #81 run `31834835143`: `static-governance`, `browser-e2e`, and `tests-and-build` all completed successfully against the implementation SHA | PASS |
| Independent review | fixed-SHA review of `cd4a056b1f97e3531dc6b0d762f5c8aec1cfcb3f..7a59b3fda24e9730aaeee0fc83b39e0a4cbcc990` found P0=0, P1=0 and P2=0 | PASS |

## Final scorecard

| Dimension | Result |
| --- | --- |
| Completeness | PASS - 12/12 tasks complete |
| Correctness | PASS - 4/4 requirements and 8/8 scenarios have implementation or executed evidence |
| Coherence | PASS - workflow, verifier, tests, governance documents and canonical specifications agree |
| Findings | 0 critical, 0 warnings, 0 suggestions |

Final assessment: the Change is eligible for its governed archive transition.
The required post-archive strict validation remains a subsequent state check
and is not represented as already complete by this report.
