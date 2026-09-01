# Tasks: stage7-three-portal-remediation

## 1. 卖家合同对齐

- [x] 1.1 `runtime.ts` `communication_screenshots` 每项补 `uploaded_at`/`uploaded_by_staff_id`/`uploaded_by_staff_name`（strict，语义与共享合同一致）
- [x] 1.2 删除 `legacy_projection` 判别与平台变体、`canonical_marketplace_code`；快照时间戳字段名对齐共享合同（`*_created_at`/`created_at`）；`SellerPages.tsx` 站点显示改用 `marketplace_code`（**7R-1 重开**：`canonicalMarketplace` 枚举仍含 `RAKUTEN_JP`/`TIKTOK_JP`，与共享 `CanonicalMarketplaceCode` 三码不一致，须收紧并补负向测试）
- [x] 1.3 合同级测试：真实后端响应形状（含三新字段）解析成功；内部敏感字段（如 `object_key`、`uploaded_by_staff_name` 之外的内部字段）仍被 strict 拒绝；`uploaded_by_staff_name` 缺省可解析
- [x] 1.4 列表接口与订单详情使用同一截图合同（read-intent schema 已对齐复核）
- [x] 1.5 既有 fixture（runtime.test、SellerPages.chat-screenshot.msw.test、demo-data.ts、stage7/seller-visual e2e）修为真实合同形状
- [x] 1.6（7R-1）`locked_service_fee_snapshot.marketplace_code` 三码枚举负向测试（RAKUTEN_JP/TIKTOK_JP 必须拒绝；三合法码必须通过；真实响应仍可解析）

## 2. 多截图渲染

- [x] 2.1 渲染完整 `communication_screenshots` 数组；每张含查看入口、上传人（中性占位）、上传时间、自身 `file_object_id`/`file_version`
- [x] 2.2 空数组明确空状态
- [x] 2.3 MSW 测试：一张/两张/多张截图；两张截图产生两个独立可操作入口（各自 read-intent 调用）
- [x] 2.4 Playwright：真实 DTO 形状 mock，断言两张截图两个入口，不止"已上传"

## 3. CSS 清理

- [x] 3.1 删除 global.css 字节级重复区块（保留一份），全仓类名引用检查防误删
- [x] 3.2 design-freeze.css 重复/无引用旧壳层/trailing whitespace 清理
- [x] 3.3 新增静态防回归检查（拒绝 ≥256 行完全重复 CSS 区块）并入验证链
- [x] 3.4 记录清理前后源文件行数/字节、构建 CSS raw/gzip
- [x] 3.5 重新生成三端截图逐张确认无视觉回退（**7R-1 重开**：7R 截图存在图片读取失败态与成员列表错误态，须补正常 mock 链路后重新生成并 13 张逐张复核）

## 4. 买家 e2e 收口

- [x] 4.1 完整运行四个买家 spec，失败逐项分类（功能/无障碍/旧断言/fixture）
- [x] 4.2 修复真实功能与无障碍问题（含 focus-visible）
- [x] 4.3 注册成功交互与当前批准行为对齐
- [x] 4.4 四个 spec 完整执行全部通过

## 5. 视觉证据与文档

- [x] 5.1 三端正常状态截图（员工/买家/卖家桌面+移动+Drawer；卖家订单页含 ≥2 张真实形状截图及上传人/时间）（**7R-1 重开**：员工订单详情图、卖家沟通截图须真实渲染图片；卖家首页成员正常态；统一 assertNoUnexpectedErrorState；禁固定 waitForTimeout 充当等待）
- [x] 5.2 修正 Stage7 交接文档失实条目（**7R-1 重开**：删除"无成员列表错误态/图片失败态"失实表述；spec 数量修正为 10 文件/160 用例）
- [x] 5.3 新增 V2_FRONTEND_REBUILD_STAGE7R_HANDOFF.md（后端缺口 vs 已修复前端缺口分开；明确非 GO）
- [x] 5.4（7R-1）员工端重复文字清理：姓名=角色时顶栏/Drawer 只显示一次（aria 保留角色语义）；`/staff` 只出现一个"工作台"上下文标题；`/staff/orders/:id` Shell 标题为"订单详情"不回退"工作台"；jsdom 测试覆盖
- [x] 5.5（7R-1）截图 spec：员工订单详情三图（付款+两沟通）正常 read-intent/content mock 且断言图片可见与文件身份正确；卖家首页成员正常 mock；卖家沟通截图两张真实展开显示图片

## 6. 验证门

- [x] 6.1 typecheck / test / build / check / openspec validate --all --strict / verify:api-contract / verify:web-source-boundaries / verify:web-static-build 全部 exit 0
- [x] 6.2 10 个 Playwright spec 文件（160 用例）一次连续执行全部 exit 0（**7R-1 更正计数**：159 passed / 1 个预存在环境门控 skipped / 0 failed）
- [x] 6.3 负向验证：真实卖家 DTO 可解析、敏感字段拒绝、两截图两入口、买家端无沟通截图入口、跨卖家组织 concealed 404、非 Owner 无成员管理、CSS 无重复区块（**7R-1 复验**：含 13 张正常状态截图内错误文本为零）
- [x] 6.4 单一本地提交 `fix(web): close stage 7 portal contract and regression gaps`；确认五提交保留、工作树干净、未 push
- [x] 6.5（7R-1）独立提交 `fix(web): complete stage 7R visual evidence`（不 amend 71fc9487；不归档本 Change）
