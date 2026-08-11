## Runtime and routing seam

The entry application selects the Review runtime only when the browser pathname is `/review` or begins `/review/`. Review uses the same React route modules behind `BrowserRouter basename="/review"`; therefore existing internal `/buyer`, `/seller`, and `/staff` links resolve to `/review/buyer`, `/review/seller`, and `/review/staff` without duplicating pages or editing every route. Formal application routing remains mounted without a basename and retains its existing Session boundaries.

`ReviewRuntimeProvider` owns only transient selection state and the compact Demo chrome. It injects Demo customer and Staff auth adapters into existing Session boundaries. Seller and Staff role changes clear only the Review QueryClient, causing the existing pages to consume refreshed Demo `me/access` or Staff Session DTOs. Real permission and capability conditions remain the rendering authority; CSS hiding is not used.

## Data and network boundary

The existing `apiRequest` transport receives one thin runtime dispatch seam. Outside Review it executes the current validated same-origin fetch flow unchanged. Inside Review it calls a central `DemoApiAdapter`, validates the result with the endpoint's existing Zod schema, and never calls `fetch`.

The adapter owns an in-memory state store and explicit method/path handlers. Registered GETs return representative Buyer, Seller, and Staff DTOs. Registered mutations change only that store and return the same runtime DTO shapes, allowing real toast, form, dialog, refetch, and state logic to run. Refreshing the browser recreates initial fixtures. An unknown path or disallowed method throws the sanitized contract error `REVIEW_MODE_REAL_API_BLOCKED`; it never falls through to production.

File read/upload flows are handled through the same explicit Demo adapter and repo-owned/data-URL placeholder assets. No Review response contains a production R2 object key or production read URL, and no Review operation invokes R2.

## Demo identities and authority

Buyer receives one Demo Customer Session with Buyer persona and Buyer-safe fixture DTOs. Seller receives one Demo Seller Member Session; the role switch changes the Seller `me/access` DTO among OWNER, OPERATIONS, FINANCE, and VIEWER. Staff receives one of the frozen roles owner, acquisition, pre_sales, seller_ops, and buyer_refund. Owner receives GLOBAL scope; ordinary roles receive AMAZON_JP marketplace scope. Role permission arrays and capability DTOs are explicit fixtures conforming to current runtime schemas.

The adapter does not infer new authority. If current UI lacks a requested action, state, route, or role surface, Review shows the current frozen implementation rather than inventing a second workflow.

## Fixture coverage

Buyer fixtures cover 6-10 varied products and the current page-supported reservation, instruction, evidence, formal-order, review, and refund states. Seller fixtures cover two stores, application/demand statuses, orders, review types, payables, and varied amount lengths. Staff fixtures cover queue work types/statuses supported by the current contract, acquisition/channel/customer data, product versions and scheduling, dashboard metrics, rate policies, access-management roles/statuses, and Operating Integrity capability states.

Fixture data is Demo-only, clearly labeled, bounded in size, displayed in Asia/Shanghai through the existing formatters, and contains no production identifiers or copied production records.

## Build identity

The Review home and chrome read a Vite compile-time `VITE_REVIEW_BUILD_SHA`. The release build supplies the exact commit SHA being deployed. Local builds fall back to `LOCAL`, which is never reported as the production deployed SHA.

## Security, privacy, and deployment

Formal `/buyer`, `/seller`, and `/staff` routes continue to use existing Customer/Staff Session boundaries. `/staff` and `/api/staff/*` remain behind the current Cloudflare Access and backend authorization behavior. Review never bootstraps or reads a real Staff Session.

Deployment uses the existing rendered production configuration and existing Worker name. It performs a dry run before `wrangler deploy`, changes Web Assets/Worker code only, runs no migration/SQL, and creates/deletes/modifies no D1, R2, Access Application, domain, secret, or second Worker.

## Migration, rollback, and rejected alternatives

Migration is `NONE`; Schema remains 64. Runtime rollback is the prior Cloudflare Worker version, followed by a branch revert if required. No D1/R2 rollback exists because Review performs zero writes.

Rejected alternatives:

- Copied Demo pages would create a second frontend and invalidate visual review.
- Per-page `if (reviewMode)` branches would spread security-sensitive routing and be easy to miss.
- MSW/service-worker interception in production would add a second network layer and permit unsafe fallthrough.
- Opening `/staff` or weakening Cloudflare Access would cross the formal Staff boundary.
- A new Worker or D1 migration would add infrastructure unrelated to a frontend-only review.
