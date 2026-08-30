# Tasks: current-documentation-fact-alignment

## 1. Evidence and scope

- [x] 1.1 Reconfirm the required branch, HEAD, clean worktree, ahead count,
  migration ledger, Schema 36, and 241-endpoint API/runtime boundary.
- [x] 1.2 Reconfirm current directory/source composition, retained release
  tombstones, historical/import quarantine boundaries, and the archived D-058
  Change path without touching remote resources.

## 2. Documentation alignment

- [x] 2.1 Update README current Schema and core release-composition wording;
  preserve historical and fail-closed boundaries.
- [x] 2.2 Remove only the non-existent `packages/ui` line from the architecture
  directory tree.
- [x] 2.3 Separate current implementation state from historical stage prose in
  `CURRENT_SYSTEM_STATE.md`; preserve 219/224/238/240/241, Schema 36, both
  NOT_RUN facts, Stage 8 authorization, and Production NO-GO.
- [x] 2.4 Change D-058 to the archived-Change tense while preserving its
  no-push, no-deploy, and no-remote-resource facts.

## 3. Verification and delivery

- [x] 3.1 Run applicable source/document guards, `npm run db:verify`,
  `npm run verify:api-contract`, and Markdown/format checks available for the
  changed files; no Buyer/Seller DTO or implementation test changes are needed
  because behavior is unchanged.
- [x] 3.2 Run strict validation for this Change and all OpenSpec Changes, then
  run `git diff --check` and verify the diff is limited to this Change plus the
  four named documentation files.
- [x] 3.3 Create one normal local commit without amend, push, deploy, or archive;
  recheck the final HEAD and clean worktree.
