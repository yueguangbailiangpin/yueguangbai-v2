# Tasks: Staff MCP and Agent Access

## 0. Governance and Provider Choice

- [ ] 0.1 Freeze Staff use cases, tool list, field whitelist, screenshot needs and prohibited actions.
- [ ] 0.2 Verify current official OpenAI/MCP authentication, data handling, tool schema and security requirements.
- [ ] 0.3 Complete privacy notice/approval for external AI processing of full WeChat IDs and selected screenshots.

## 1. Contracts and Migration Decision

- [ ] 1.1 Define versioned read/draft tool schemas, errors, cursor limits, source references and confirmation links.
- [ ] 1.2 Inventory Staff/Audit schema and justify no Migration or allocate the next consecutive Migration.
- [ ] 1.3 Add static forbidden-field/tool checks for credentials, Secrets, bulk export and direct SQL/path access.

## 2. Authentication and Tools

- [ ] 2.1 Implement approved OAuth/client binding to existing ACTIVE Staff and current D1 authorization resolution.
- [ ] 2.2 Implement bounded task/customer/order/review/refund/settlement read tools through Application Services.
- [ ] 2.3 Implement Chinese WeChat message, reconciliation, audit recommendation and payment-batch draft tools.
- [ ] 2.4 Reuse controlled file authorization for explicitly requested screenshots.
- [ ] 2.5 Add per-tool kill switches, rate limits and immutable safe call audit.

## 3. Tests and Acceptance

- [ ] 3.1 Test roles, Personal DENY, Team/Store/Customer scope and concealed resources for every tool.
- [ ] 3.2 Test expired/unknown client identity, replay, rate limit, Provider outage and audit integrity.
- [ ] 3.3 Test prompt injection in customer text/screenshots and prove it cannot widen tools or authority.
- [ ] 3.4 Test full WeChat/screenshot allowed paths and credential/Secret/bulk-export forbidden paths.
- [ ] 3.5 Prove all formal finance/approval changes still require current Web permission/version and employee click.
- [ ] 3.6 Run protocol conformance, workspace, security, strict OpenSpec and formal Verify gates.

## 4. Rollback and Release

- [ ] 4.1 Verify global/per-tool disablement leaves D1/Web unchanged.
- [ ] 4.2 Launch read-only, then drafts; require a separate future Change for any formal write tool.
- [ ] 4.3 Keep Buyer/Seller MCP unregistered and unadvertised.
