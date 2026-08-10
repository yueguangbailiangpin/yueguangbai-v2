# Staff Access Cutover Checklist

This branch replaces the active Staff Feishu login/workbench composition with Cloudflare Access + email identity bootstrap.

**Do not deploy this authentication cutover to production until the primary Owner email has been bound.**

## 1. Cloudflare Access

Create/protect the Staff application in Cloudflare Access and enable One-Time PIN (email OTP).

Allow only explicit employee emails.  Because the team is small, manage this allow-list manually.

Configure Worker bindings/secrets:

- `STAFF_ACCESS_TEAM_DOMAIN` — exact Cloudflare Access team origin, for example `https://<team>.cloudflareaccess.com`
- `STAFF_ACCESS_AUD` — Access application audience tag
- `STAFF_AUTH_ALLOWED_ORIGINS` — Moonwhite Staff web origin(s)

The Worker validates `Cf-Access-Jwt-Assertion` signature, issuer, audience and expiry before trusting the email.

## 2. Database migrations

Test migrations `0044`, `0045`, `0046` on a scratch/copy database first.

The cutover migration intentionally revokes old Staff sessions.  Existing ordinary business roles are backfilled to `AMAZON_JP` because the current live business is JP-first.

## 3. Bind the existing primary Owner email

Migration `0044` creates `staff_email_identities`, but cannot guess the real Owner email.

Before the first Access-only production login:

1. Query the current ACTIVE Owner Staff ID.
2. Normalize the Owner email to lowercase.
3. Insert exactly one ACTIVE row into `staff_email_identities` for that Staff ID.
4. Add the same email to the Cloudflare Access allow policy.
5. Confirm `/staff/login` → Access OTP → `/api/staff-auth/access/bootstrap` creates the Moonwhite Staff session.

Do not hard-code the personal email in repository source or migration history.

## 4. Create a backup Owner

After primary Owner login works:

1. Use Staff 管理 to create a second Owner using an independent email controlled by the business owner.
2. Add that email to Cloudflare Access.
3. Test a login once.
4. Keep it unused for emergency recovery.

The server also prevents the last active Owner from being disabled/demoted.

## 5. Employee onboarding after cutover

For each employee:

1. Staff 管理 → 新增员工.
2. Enter name, personal/login email, one role and Marketplace(s).
3. Add the same email manually to Cloudflare Access.
4. Employee opens Staff and completes email OTP.

No Feishu binding, Team selection or raw permission selection is required.

## 6. Codex acquisition machine entry

The Codex machine API is independent from Staff Access.

Only when the future Codex acquisition system is enabled, configure a strong secret:

- `ACQUISITION_MACHINE_SHARED_SECRET`

Codex must also send a stable `X-Moonwhite-Machine-Id` and idempotency key.

Do not reuse the Staff/Customer session secrets for this machine secret.

## 7. Production verification before declaring cutover complete

Verify:

- primary Owner can login;
- backup Owner can login;
- normal JP Pre-sales/Seller Ops/Buyer Refund can login;
- each role only sees its frozen navigation;
- non-owner Marketplace isolation is enforced server-side;
- DISABLED Staff is rejected even after successful Cloudflare OTP;
- changing Staff email/role/Marketplace invalidates previous sessions;
- Feishu callback/login/workbench routes are not active in the production composition.
