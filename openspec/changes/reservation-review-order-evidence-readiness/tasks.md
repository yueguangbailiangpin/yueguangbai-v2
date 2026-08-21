## Specification and implementation

- [x] Record the privacy boundary and forward-only Schema 71 application-amount migration.
- [x] Add buyer identity facts to assigned Staff reservation review context.
- [x] Close the successful reservation action locally without refetching completed review facts.
- [x] Surface safe API error code and request ID on mutation failure.
- [x] Require an ACTIVE matching order instruction in the buyer eligible-reservation read model.
- [x] Add and bind the internal staging keyword PNG generator with R2-hosted font and separate secrets.
- [x] Add API and frontend regression coverage.
- [x] Run focused tests and type checks.
- [x] Export and hash the old staging D1 before deletion.
- [x] Recreate staging D1, apply migrations 0001-0070 and restore the test Owner.
- [x] Explain an empty customer-intake site selector and scope channels to the selected site.
- [x] Seed audited staging-only manual Buyer and Seller intake channels for `AMAZON_JP`.
- [x] Keep the mounted Staff shell visible when its browser tab regains focus.
- [x] Show newly saved Seller organizations before portal registration and explain duplicate saves.
- [x] Allow Staff to generate or safely replace a Seller registration link from the directory.
- [x] Keep Buyer Tasks and Me navigation interactive across route and focus changes.
- [x] Allow all active Seller members and scoped Staff to create authorized Stores before the first product application.
- [x] Replace every current image or evidence file input with the shared select, drag, paste, preview and remove control.
- [x] Configure the isolated staging first Owner as the explicit JP assignment fallback so product applications can create review work items after a rebuild.
- [x] Close successful product application review locally without rereading a completed task.
- [x] Require and persist the Seller-entered positive JPY product amount and prefill it for Staff review.
- [x] Add a direct preselected “创建预约需求” path without bypassing demand quantity or schedule authority.
- [x] Advance local migration guards and readiness targets to the continuous 0001-0071 chain.
- [x] Close the demand review publish/reject action locally, show the safe error code and request id on failure, and gate duplicate submits with same-key retry for ambiguous outcomes.

## Remote boundary

- [ ] GitHub push or PR (not authorized).
- [x] Deploy the fixed main staging Worker with the rebuilt D1, R2 and private keyword-image service binding.
- [x] Deploy commit `253b6c2d6b0ca8a6b40d9faaabd10d9568731ad9` (demand review publish outcome visibility) to staging via release worktree `release-253b6c2`; preflight `LOCAL_CONFIG_VALID`; version `919b1ac4-ec5c-4691-8f91-83bb3c35a5c6` at 100%.
- [ ] Verify application `/health` and `/ready` through an authenticated Cloudflare Access session; unauthenticated probes redirect to Access by policy.
