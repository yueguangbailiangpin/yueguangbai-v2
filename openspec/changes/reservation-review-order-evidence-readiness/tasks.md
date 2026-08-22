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
- [x] Replace keyword-image preparation with direct publication of immutable ordered keyword text and Store/order facts, visible to Buyer only after `ACTIVE`.
- [x] Audit the remaining Buyer, Seller and Staff mutations; close terminal review tasks locally and separate committed Staff command success from any follow-up refresh failure.

## Remote boundary

- [ ] GitHub push or PR (not authorized).
- [x] Deploy the fixed main staging Worker with the rebuilt D1, R2 and private keyword-image service binding.
- [x] Deploy commit `253b6c2d6b0ca8a6b40d9faaabd10d9568731ad9` (demand review publish outcome visibility) to staging via release worktree `release-253b6c2`; preflight `LOCAL_CONFIG_VALID`; version `919b1ac4-ec5c-4691-8f91-83bb3c35a5c6` at 100%.
- [x] Deploy commit `706c04860e0d077849e3b837d769fdd45b244a54` (failing publish readiness field surfaced via safe error details) to staging via release worktree `release-706c048`; preflight `LOCAL_CONFIG_VALID`; version `66c8ba45-3b5e-4a70-8af0-fcc0b16fe968` at 100%.
- [x] Deploy commit `89777e2ab96909471e4cee892c5ae2d1726b681e` (staff product main image display + upload/bind) to staging via release worktree `release-89777e2`; preflight `LOCAL_CONFIG_VALID`; version `298966ba-feb0-40a4-bee3-0a07006d842a` at 100%.
- [x] Deploy commit `a9c6440172f7dd8683dbfc5e1c489d3255f57ef1` (Buyer main-image/zero-self-pay/text-instruction flow plus Staff mutation-outcome audit) to staging via release worktree `release-a9c6440`; preflight `LOCAL_CONFIG_VALID`; Schema and migration ledger `71/71`; version `61a98ef8-48a3-496e-9884-88e37722e25f` at 100%.
- [x] In an authenticated Buyer session, verify the active instruction shows Store `chyz`, text keyword `コーヒー スケール`, the main-image action and order facts, and verify Tasks → Me → Tasks remains interactive without browser errors.
- [ ] Exercise the terminal Staff review/refund/integrity mutations in an authenticated Staff application session; the available Access session could not establish an active Staff application session, so this remains automated-test evidence only.
- [ ] Verify application `/health` and `/ready` through an authenticated Cloudflare Access session; unauthenticated probes redirect to Access by policy.
