# customer-portal-presentation Specification

## Purpose
规定买家、卖家客户门户的独立入口、最小信息投影、服务端可预约产品资格、返款术语、中文文案和北京时间展示。
## Requirements
### Requirement: Login identity is path-bound
The customer login flow SHALL derive Buyer or Seller intent from the controlled route and SHALL NOT render or accept a customer-selectable Persona field.

#### Scenario: Buyer and Seller use independent links
- **WHEN** a customer opens `/buyer/login` or `/seller/login`
- **THEN** the submitted login target is respectively Buyer or Seller and cannot be changed in the page.

### Requirement: Login copy is minimal
Each customer login page SHALL display only 月光白, 账号, 密码 and 登录 as its core visible content and SHALL omit the frozen duplicate identity and workspace copy.

#### Scenario: Login page is inspected
- **WHEN** either login route renders at desktop or mobile width
- **THEN** no Buyer service, Seller workspace, safety slogan, identity selector or duplicate login heading is present.

### Requirement: Buyer product area is eligibility-bound
The Buyer product area SHALL be named 产品 and SHALL expose only products with a currently reservable demand for the current Buyer under server-authoritative eligibility.

#### Scenario: Product eligibility changes
- **WHEN** Marketplace, window, capacity, history or Buyer eligibility makes a product unavailable
- **THEN** it is absent from the product area and a stale reservation submit is still rejected by the server.

### Requirement: Buyer internal fields are minimized
Buyer pages and DTOs SHALL omit customer number, session expiry and refund obligation/payment/update timestamps unless a later approved Change establishes a customer need.

#### Scenario: Buyer data reaches the browser
- **WHEN** profile or refund data is fetched and rendered
- **THEN** the forbidden internal fields are absent from both the visible page and the first-party response projection.

### Requirement: Buyer refund wording is fixed
Buyer refund interfaces SHALL use 返款金额 for the amount that represents refundable product principal only.

#### Scenario: Refund detail renders
- **WHEN** a Buyer views a refund obligation or payment status
- **THEN** the page says 返款金额 and does not imply commission, reward or Seller service fee is refunded.

### Requirement: Seller internal copy is removed
Seller pages SHALL retain required business terms while omitting duplicate workbench/home/Seller titles, disabled-market notices and internal server/staff-control explanations.

#### Scenario: Seller pages render
- **WHEN** the Seller visits home, settings or settlement views
- **THEN** Seller principal and Seller service fee remain available but the frozen internal copy is absent.

### Requirement: Customer time is Beijing time
All customer-visible timestamps SHALL format UTC facts in `Asia/Shanghai` and use the visible term 北京时间 rather than 中国标准时间.

#### Scenario: A customer-visible timestamp renders
- **WHEN** the same UTC fact is viewed on Buyer or Seller pages
- **THEN** its calendar/time value follows `Asia/Shanghai` and the label is 北京时间.
