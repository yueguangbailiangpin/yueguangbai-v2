# Tasks: Staff MCP and Agent Access

## 0. Governance and Provider Choice

- [x] 0.1 Freeze Staff use cases, 13-tool list, field whitelist, single-task screenshot needs and prohibited actions.
- [x] 0.2 Verify current official OpenAI/MCP authentication, data handling, tool schema and security requirements; record retrieval date and implementation/external boundaries.
- [x] 0.3 Record external AI privacy notice/approval as an uncompleted production hard gate in the final owner checklist; do not claim the external approval itself is complete.

## 1. Contracts and Migration Decision

- [x] 1.1 Define versioned read/draft tool schemas, errors, cursor limits, source references and controlled Web confirmation paths.
- [x] 1.2 Inventory Staff/Audit schema and prove no Migration: schema remains 0034 and existing immutable audit triggers are reused.
- [x] 1.3 Add static forbidden-field/tool checks for credentials, Secrets, bulk export and direct SQL/path access.

## 2. Authentication and Tools

- [x] 2.1 Implement OAuth/client verifier port plus local mock mapping to one existing ACTIVE Staff and current D1 authorization resolution; keep real OAuth unimplemented and hard-disabled.
- [x] 2.2 Implement bounded task/customer/order/review/refund/settlement read tools through the Application Service port and local mock.
- [x] 2.3 Implement Chinese WeChat message, reconciliation, audit recommendation and payment-batch draft tools.
- [x] 2.4 Model and test controlled file Audience + Read Intent for one explicitly requested task screenshot; keep storage identifiers out of MCP.
- [x] 2.5 Add global/per-tool kill switches, client/tool rate limits, replay/concurrency boundaries and immutable safe call audit.

## 3. Tests and Acceptance

- [x] 3.1 Test roles, Personal DENY, Team/Department/Store/Customer/Marketplace scope and concealed resources across the frozen tools.
- [x] 3.2 Test expired/unknown client identity, replay, concurrency, rate limit, Provider outage and audit integrity/fail-closed.
- [x] 3.3 Test prompt injection in customer text/screenshots and prove it cannot widen tools or authority.
- [x] 3.4 Test full WeChat/screenshot allowed paths and credential/Secret/bulk-export forbidden paths.
- [x] 3.5 Prove all formal finance/approval/order changes still require current Web permission/version and employee click.
- [x] 3.6 Run protocol conformance, workspace, security, strict OpenSpec and formal Verify gates.

## 4. Rollback and Release

- [x] 4.1 Verify global/per-tool disablement leaves D1/Web unchanged.
- [x] 4.2 Document and dry-run the future read-only-then-drafts launch plan locally; perform no real launch and require a separate future Change for any formal write tool.
- [x] 4.3 Keep Buyer/Seller MCP unregistered and unadvertised.
- [x] 4.4 Publish the final owner checklist for real OAuth, external AI privacy approval, durable provider decisions, ChatGPT registration and production activation; keep every external item explicitly unchecked.
