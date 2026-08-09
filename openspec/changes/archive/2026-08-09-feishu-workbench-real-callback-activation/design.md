# Design

## Protocol boundary

URL registration is a distinct no-write protocol step. When all three `X-Lark-*` authentication headers are absent, the route may decode only an exact `{challenge, token, type}` object or an exact `{encrypt}` wrapper whose plaintext is that object. `type` must be `url_verification`, `challenge` is bounded, and `token` must match the managed Verification Token in constant time. Any other unsigned body is rejected.

If any authentication header is present, all three are required and the existing five-minute window, SHA-256 signature, AES-CBC decryption and exact formal callback contract remain mandatory. Formal card callbacks still enter the durable receipt, identity, unique role, Personal DENY, Scope, expected-version, idempotency, Audit and Outbox path.

## Data and permissions

The URL challenge performs no D1 read or write. Formal callback permissions and D1 authority are unchanged. Feishu receives only the existing minimal safe task projection and controlled Web deep link.

## Rejected alternatives

- Disabling Encrypt Key was rejected because it would reduce formal callback protection.
- Allowing any unsigned callback was rejected because only exact URL verification is safe without signature headers.
- Treating registration failure as an operator-only problem was rejected because the production protocol and local implementation demonstrably disagreed.

## Acceptance and rollback

Acceptance requires local challenge/event tests, the existing Feishu verifier and typecheck, a real production challenge returned within the Feishu console deadline, and callback/sync kill-switch evidence. Any failure keeps sync disabled; rollback restores both workbench flags to false and leaves D1 facts untouched.
