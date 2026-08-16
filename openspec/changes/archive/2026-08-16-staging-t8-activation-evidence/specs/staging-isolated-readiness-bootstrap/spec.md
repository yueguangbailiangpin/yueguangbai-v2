# staging-isolated-readiness-bootstrap Delta

## ADDED Requirements

### Requirement: T8 activation evidence is redacted and independently reviewable

The repository SHALL record a T8-only staging activation summary that proves the reviewed release identity, isolated resource classes, Schema 70 migration ledger, pre/post integrity and foreign-key results, first-Owner outcome, required managed Secret names, Access-protected custom domain and authenticated health/readiness results. The committed evidence SHALL exclude Cloudflare resource IDs, Access audience/policy IDs, emails, Secret values, request IDs and raw provider logs. T9 business acceptance, T10 recovery and Production GO SHALL remain separate.

#### Scenario: Staging infrastructure baseline is activated

- **WHEN** the exact reviewed tree is ordinarily merged and deployed only to isolated staging resources, migrations 0069 and 0070 complete from an empty Schema 68 baseline, first-Owner bootstrap succeeds, and authenticated health/readiness return the governed staging profile
- **THEN** the T8 evidence records the merged SHA, Schema/ledger 70, integrity `ok`, zero foreign-key errors, one Owner authority, real R2 binding health, four `ok` readiness checks and five `not_required` checks without recording sensitive provider values.

#### Scenario: Evidence attempts to overclaim scope

- **WHEN** a T8 report includes T9 role/business acceptance, T10 recovery, production evidence, raw provider identifiers or unverified health claims
- **THEN** the Change is not ready for independent review or archive.
