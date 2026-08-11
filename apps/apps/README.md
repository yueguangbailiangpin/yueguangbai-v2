# Source-test path compatibility fixture

This directory is **not runtime code and not a workspace**. It exists only because a small set of second-layer `*.source.test.ts` files were committed one directory deeper than the repository-root helper assumed. The files below contain marker-only source fixtures for those tests.

Local Codex may normalize those test `root` expressions to the actual repository root and delete this entire `apps/apps` directory once the clean-checkout test suite is running. Product/runtime imports must never reference this directory.
