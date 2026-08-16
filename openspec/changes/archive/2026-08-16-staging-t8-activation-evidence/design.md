# Design: Staging T8 Activation Evidence

## Evidence boundary

The committed record contains only release SHAs, aggregate counts, state labels and logical references to a Git-external `0600` evidence bundle. Cloudflare account/resource IDs, Access audience and policy IDs, test emails, Secret values, request IDs and raw logs remain outside Git.

The evidence is T8-only. It proves the infrastructure baseline needed before T9, but it does not claim that the five Staff roles, Buyer/Seller portals or the A-H business matrix have passed. Recovery remains T10 and Production GO remains `NO_GO`.

## Release identity

PR #85 was independently reviewed at `b21a826c6832104db1db6265e692c9362ddf0b0c` and ordinarily merged as `10624b1066143b7ac57923597a1d877209959a4a`. The merge commit has the reviewed head as its second parent and the same Git tree. The staging release uses the merged main SHA, preserving a verifiable path from review to deployment without claiming that two different trees were reviewed.

## Database evidence

Before migration, the exact staging D1 identity matched the Git-external config, Schema and ledger were both 68, and the database was exported and reconstructed with native SQLite. Integrity was `ok` and foreign-key errors were zero. Wrangler then applied the exact two pending files, 0069 and 0070, with provider rollback semantics. A second export reconstructed Schema and ledger 70 with integrity `ok` and zero foreign-key errors.

The first-Owner operator command used a `0600` external input and the existing parameterized atomic bootstrap. Final aggregate evidence is one Staff user, one active Owner role and one synthetic staging Buyer channel. No identity value is committed.

## Runtime evidence

The deployed Worker binds only the staging D1 and staging R2 bucket, carries the merged main SHA and exposes only the staging custom domain. The two initial managed Secret names exist only on the staging Worker. Scheduler, Outbox Delivery, Acquisition Maintenance and operational alerts remain disabled.

Unauthenticated `/health` and `/ready` redirect to Cloudflare Access. After operator OTP authentication, same-origin probes returned 200. The empty-database readiness path can report `object_storage=ok` only after the runtime calls the R2 binding's real `headObject` probe; a rejected or missing binding returns `failed`.

## Rejected alternatives

- Committing raw Cloudflare JSON or headers would leak durable identifiers and test identity data.
- Treating an Access 302 as application health would confuse edge protection with Worker readiness.
- Uploading a synthetic R2 object only to manufacture evidence is unnecessary because the empty-bucket readiness path already performs a real binding head probe.
- Targeting production resources with read or write operations to strengthen a staging report violates the authorization boundary. The Access management list incidentally displayed an existing non-staging application row; no production application details were opened and no production mutation was performed.
