## 1. Runtime repair

- [x] 1.1 Capture redacted staging evidence that Access headers are present and bootstrap fails at JWKS fetch.
- [x] 1.2 Replace the unsupported redirect mode without weakening exact-domain or non-2xx rejection.
- [x] 1.3 Assert the outbound JWKS request contract in the focused unit test.

## 2. Verification and delivery

- [x] 2.1 Run the focused Cloudflare Access tests, API typecheck and diff checks.
- [x] 2.2 Run strict OpenSpec validation and the repository checks proportionate to the two-file security fix.
- [ ] 2.3 Publish a Draft PR and obtain an independent fixed-SHA P0/P1 review.
- [ ] 2.4 Convert Ready, ordinarily merge, prove merge tree identity and deploy only the merged SHA to staging.
- [ ] 2.5 Verify authenticated Owner bootstrap/session on staging and record redacted evidence before resuming T9.
