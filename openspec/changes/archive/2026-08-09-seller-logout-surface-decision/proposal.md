## Why

The product owner has explicitly decided that the Seller portal must not offer a voluntary logout entry. This must be recorded without weakening the shared Customer-session cleanup that protects Buyer and Seller data on 401, identity mismatch, or invalidation.

## What Changes

- Record the accepted product decision in the authoritative decision register and product rules.
- Modify the frontend-session-auth contract so Buyer keeps voluntary logout while Seller has no logout surface.
- Preserve automatic Customer logout and both-root cache cleanup for Seller safety failures.
- Add no Seller action, endpoint, UI control, or Seller-specific logout test.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `frontend-session-auth`: Separate voluntary Buyer logout presentation from mandatory shared Customer-session safety cleanup, and forbid a Seller logout surface.

## Impact

Product and OpenSpec authority only. Seller production UI already has no logout entry, so no Web, API, Migration, permission, session implementation, dependency, or external-system change is required.
