## 1. Product and Contract Authority

- [x] 1.1 Record the accepted Seller-no-logout decision in the decision register and product rules.
- [x] 1.2 Update the frontend-session-auth requirement without weakening Buyer logout, mismatch cleanup, 401 invalidation, or both-root cache clearing.

## 2. Scope Verification

- [x] 2.1 Confirm the Seller account and shell expose no logout entry and add no Seller logout code or dedicated test.
- [x] 2.2 Run frontend auth/session regression coverage and strict OpenSpec validation.
- [x] 2.3 Confirm no Migration, API, permission, DTO, dependency, external write, or production action occurred.
