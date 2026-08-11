# Change Proposal: Schema 64 Integration Stabilization

## Why

The integrated Staff acquisition branch contains the intended Schema 64 business model but still carries obsolete Feishu Staff authentication/workbench/alert composition, stale route inventory, duplicate acquisition routing and pre-Schema-64 release checks. These conflicts can make an otherwise valid release fail closed for the wrong reason or expose two competing runtime authorities.

## What Changes

- Retire active Feishu authentication, workbench synchronization, callback and operational-alert code/configuration while preserving historical migration bytes.
- Make Cloudflare Access email proof plus Moonwhite Staff accounts the only Staff authentication composition.
- Align Staff account management with email, one role and explicit Marketplace PRIMARY/SUPPORT responsibility.
- Repair duplicate acquisition route registration and update runtime contracts, release preflight, UI tests, OpenSpec and current documentation.
- Keep disabled Staff MCP completely absent from production provider variables and service bindings so it cannot block the first release.
- Stabilize migrations 0044–0064, authorization behavior and affected Contract/API/Web tests without touching production resources.

## Non-Goals

- This code Change does not itself authorize production Mutation; the separate owner deployment instruction controls those operations.
- No Feishu replacement integration, new alert Provider, Team/Leader authority, arbitrary GRANT expansion, reassignment UI or availability scheduler.
- No rewrite of historical migrations 0001–0043 or archived Change evidence.

## Rollback

Application changes can be reverted as one branch commit group before deployment. Migrations remain forward-only; 0001–0043 stay byte-identical and 0044–0064 are validated as a continuous local chain. Reintroducing Feishu would require a new explicitly approved Change rather than reverting release validation alone.
