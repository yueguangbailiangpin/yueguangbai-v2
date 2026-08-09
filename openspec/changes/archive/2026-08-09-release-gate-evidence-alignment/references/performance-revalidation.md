# Performance Revalidation Evidence

Date: 2026-08-09 (Asia/Shanghai)

## Method

- Built the current Web candidate and served it with the repository production-preview path on an unused loopback port.
- Ran five anonymous Buyer and five anonymous Seller login-to-first-page samples with `scripts/measure-frontend-runtime-performance.mjs`.
- Recorded JavaScript transfer, visible-page timing, post-click API paths/durations, and duplicate API path counts.
- No production URL, account, data, Provider, secret, or external network was used.

## Results

| Measure | Buyer | Seller |
| --- | ---: | ---: |
| Initial entry | 245,784 B raw / 74,236 B gzip | same shared entry |
| Post-login JavaScript | 40,216 B / 6 requests | 36,149 B / 4 requests |
| Median first-page visible | 357.2 ms | 353.5 ms |
| Median post-click API requests | 3 | 6 |
| Duplicate API paths | none in all 5 runs | none in all 5 runs |
| Fulfilled API duration range | about 0.5–13.2 ms | about 0.5–13.2 ms |

Buyer requested login, session, and demands exactly once per run. Seller requested login, session, me, formal orders, settlement summary, and stores exactly once per run. No non-authenticated React Query retry/refetch duplication was observed. Route-specific transfer remains at the accepted baseline, and the samples do not show a material shared-chunk or render regression.

## Decision

No runtime application change is justified. Further speculative splitting or session/cache changes would add risk to identity mismatch, 401 invalidation, and Personal DENY freshness without measured benefit. These are local laboratory timings only; production LCP, INP, and CLS were not measured and remain unverified.
