# Tasks: Staging T8 Activation Evidence

- [x] 1. Lock PR #85 reviewed head, ordinary merge SHA, parents and equal tree.
- [x] 2. Render and preflight the Git-external staging config at the merged main SHA.
- [x] 3. Export/reconstruct Schema 68 and verify integrity plus foreign keys before migration.
- [x] 4. Apply only pending migrations 0069 and 0070 to the exact staging D1.
- [x] 5. Export/reconstruct Schema 70 and verify ledger, integrity and foreign keys.
- [x] 6. Bootstrap the first Owner and synthetic staging Buyer channel atomically.
- [x] 7. Deploy the isolated staging Worker with D1, R2, two managed Secrets and custom domain.
- [x] 8. Verify Access protection, exact-five allow-policy identity set, DNS and HTTPS.
- [x] 9. Verify authenticated `/health=200` and staging `/ready=200`, including the real empty-bucket R2 head probe.
- [x] 10. Record only redacted T8 evidence and retain raw provider evidence outside Git at mode `0600`.
- [x] 11. Keep T9, T10, T11 and all production operations outside this Change.
- [x] 12. Run Formal Verify, strict OpenSpec validation and repository checks at the final evidence SHA.
- [x] 13. Publish Draft PR #86 at the final evidence SHA.
- [ ] 14. Obtain independent fixed-SHA review before Ready/merge or archive.
