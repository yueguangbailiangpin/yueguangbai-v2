## MODIFIED Requirements

### Requirement: Logout follows Cookie transport ownership and does not persist sensitive state

The Buyer portal SHALL offer voluntary logout through `POST /api/customer-auth/logout`; after success the frontend SHALL cancel/remove both Buyer and Seller protected roots and reset both Customer states because the shared Cookie is cleared. The Seller portal SHALL NOT expose a voluntary logout entry, action, or alternate Seller-specific logout flow. Seller identity mismatch, validated Customer 401, invalid Session, credential reset, and other existing fail-closed safety paths SHALL retain access to the shared Customer logout and both-root cleanup. Staff logout SHALL use `POST /api/staff-auth/logout`, optional approved all-device action SHALL use `/api/staff-auth/logout-all` with required idempotency semantics, and success SHALL clear Staff only. No Session token or sensitive cache SHALL enter localStorage/sessionStorage.

#### Scenario: Buyer completes voluntary logout

- **WHEN** a Buyer uses the visible logout action and Customer logout succeeds
- **THEN** Buyer and Seller requests/caches are canceled and cleared, both Customer states reset, and Staff remains unchanged.

#### Scenario: Seller portal renders

- **WHEN** any Seller shell, navigation, account page, or protected Seller surface is displayed
- **THEN** no voluntary logout entry, Seller-specific logout action, or alternate logout route is offered.

#### Scenario: Seller safety cleanup is required

- **WHEN** Seller entry detects account-type mismatch, a validated Customer 401, an invalid Session, or another existing Customer safety-cleanup condition
- **THEN** the shared Customer logout and both-root cancellation/removal remain fail closed, no Seller content renders from stale state, and Staff remains unchanged.

#### Scenario: Staff logout or sensitive persistence is evaluated

- **WHEN** Staff logout runs while Customer roots coexist or code attempts to persist a Session token or sensitive cache
- **THEN** Staff cleanup affects only Staff, Customer state is preserved, and persistence checks fail for sensitive data.
