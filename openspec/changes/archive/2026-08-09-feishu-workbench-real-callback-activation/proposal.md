# Change: Feishu workbench real callback activation

## Why

The production Feishu console validates a developer-server callback URL with a token-bound URL challenge before formal callback delivery. Current code requires the formal `X-Lark-*` signature headers before it can decrypt or parse that registration challenge, so the real console reports that no challenge code was returned even though signed callback handling is correct.

## What Changes

- Accept the bounded Feishu URL-verification challenge with no signature headers when its body is either exact plaintext challenge JSON or the exact encrypted wrapper, and require the configured Verification Token in constant time.
- Continue requiring complete signature, timestamp, nonce, Encrypt Key decryption, Verification Token, App/Tenant binding, replay protection and D1 authorization for every formal callback event.
- Record real callback registration, send/receive acceptance and rollback evidence without turning Feishu into a business or financial source of truth.

## Non-goals

- No new business action, role, permission, finance field, schema or Migration.
- No weakening of formal event signature, replay, idempotency, Personal DENY, Scope or D1 authority.
- No Drive, Staff MCP or backup/restore activation.

## Migration

`NO_SCHEMA_CHANGE`.

## Risk and rollback

The unsigned branch can only echo a bounded opaque challenge after exact-key parsing and Verification Token comparison; it cannot call D1 or execute an action. Rollback disables `FEISHU_WORKBENCH_SYNC_ENABLED` first and `FEISHU_WORKBENCH_CALLBACK_ENABLED` second, while keeping all D1 facts, mirrors, receipts and outbox records intact.
