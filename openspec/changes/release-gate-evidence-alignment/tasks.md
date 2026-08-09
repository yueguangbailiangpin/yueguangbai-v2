## 1. Evidence Alignment

- [ ] 1.1 Reproduce the final-production and Staff MCP formal verifier failures.
- [ ] 1.2 Make all touched Change evidence reads accept exactly one active or dated archive source.
- [ ] 1.3 Validate all five Staff MCP invariants as exact mappings contained in the current authoritative requirement set.
- [ ] 1.4 Refresh current Production GO evidence and checklist language without rewriting historical archived evidence.

## 2. Release Aggregate Gate

- [ ] 2.1 Add a release-only command that runs the current main gate and final-production, Cloudflare, production-readiness, Drive, Feishu, and Staff MCP local verifiers/preflights.
- [ ] 2.2 Bind the command output to the current clean candidate commit and tree and preserve an explicit production `NO-GO` result.
- [ ] 2.3 Add focused tests for ambiguous Change evidence, subset mapping, candidate cleanliness/provenance, and command failure propagation.

## 3. Performance and Validation

- [ ] 3.1 Re-run bundle/runtime evidence and inspect for non-authenticated React Query duplication, shared-chunk waste, or obvious render waste before changing runtime code.
- [ ] 3.2 Record local-only results and do not claim production LCP, INP, or CLS.
- [ ] 3.3 Prove both originally failing verifier commands now pass.
- [ ] 3.4 Run strict OpenSpec validation, dependency/secret checks, and the final aggregate gate on the committed clean candidate.
- [ ] 3.5 Report all external/provider/production items as unexecuted and `NO-GO`.
