# buyer-routing-dashboard Specification Delta

## MODIFIED Requirements

### Requirement: Dedicated Buyer entry routing

The Web application SHALL keep `/` as the exact dedicated-link notice, expose `/buyer/login` for existing Buyers and `/buyer/register` only as a direct staff-supplied link, and protect every `/buyer/**` business route with the existing Buyer Customer Session boundary. The login page SHALL NOT advertise registration or any Seller or Staff entry.

#### Scenario: Existing or new Buyer uses the supplied route

- **WHEN** an existing Buyer opens `/buyer/login` or a new Buyer opens the directly supplied `/buyer/register`
- **THEN** the matching flow is shown without exposing another identity entry.

#### Scenario: Root or login is inspected for discovery links

- **WHEN** an unauthenticated visitor opens `/` or `/buyer/login`
- **THEN** no registration, Seller, or Staff link is present and the root still shows only `月光白` and `请使用工作人员发给您的专属链接登录。`.
