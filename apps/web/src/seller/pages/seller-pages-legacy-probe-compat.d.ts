// The active extensionless SellerPages import resolves SellerPages.ts first.
// This ambient name keeps a one-token legacy probe artifact type-safe if the
// historical SellerPages.tsx file is still included by tsc before local Codex
// removes/restores that unused comparison artifact.
declare const PROBE: unknown;
