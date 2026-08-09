# Tasks

- [x] Verify `origin/main` SHA and isolate worktree without touching the dirty main worktree.
- [x] Record existing seller/member/login/store/product/reservation constraints and frozen source rules.
- [x] Add migration 0040 with channel seeds, seller claim subject typing, import trace tables, standard products, offerings, and reservation eligibility projection.
- [x] Implement alias/folder resolution, normalization, duplicate detection, quarantine, and deterministic manifest hashing.
- [x] Implement preview and atomic commit/replay behavior with disabled historical organizations and no login/invitation side effects.
- [x] Add anonymous fixtures and tests for same-folder grouping, cross-folder duplicate WeChat, cross-seller duplicate ASIN, unknown aliases, conflicting duplicate source rows, and repeat commit.
- [x] Run the full repository gate after the complete Change is present; repair failures and run targeted re-tests.
- [x] Obtain independent total-control review before any production migration or data import. No production action is authorized by this Change.
