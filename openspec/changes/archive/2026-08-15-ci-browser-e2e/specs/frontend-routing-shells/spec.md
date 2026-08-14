# frontend-routing-shells Specification Delta

## MODIFIED Requirements

### Requirement: Public routing preserves dedicated-link semantics

React Router SHALL own `/`, `/buyer/login`, `/seller/login`, and `/staff/login`. The root SHALL show only `月光白` and `请使用工作人员发给您的专属链接登录。`; it SHALL NOT show Buyer, Seller, or Staff login controls or identity links. All three login routes SHALL remain directly reachable. Hidden navigation SHALL NOT be represented as a security control.

#### Scenario: Root entry

- **WHEN** an unauthenticated user opens `/`
- **THEN** the page shows `月光白` and the dedicated-link notice without any identity control or link.

#### Scenario: Direct Staff or unknown public route

- **WHEN** a user directly opens `/staff/login` or an unknown public path
- **THEN** Staff login remains reachable and the unknown path renders a safe NotFound rather than redirecting across identities.
