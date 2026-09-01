## 1. 设计审查（阻塞实现）

- [ ] 1.1 Codex 只读审查本草案六个关键决策（2026-09-01 01:40 协作轮）。
- [x] 1.2 Owner 2026-09-01 裁决：预约资格=自动上架可约；D-056 修订采 Codex 建议以新条目取代（实现时随 2.3 落地）。

## 2. 合同与迁移

- [ ] 2.1 contracts canonical + marketplace-runtime 定义扩展（五平台：+RAKUTEN_JP/YAHOO_JP/TEMU_JP/TIKTOK_JP，AMAZON_US 启用）。
- [ ] 2.2 迁移（预计 0041）：市场注册表种子、CHECK/触发器 allowlist、全对象 CHECK allowlist 盘点、锚点全套。
- [ ] 2.3 Decision Register D-056 修订记录。

## 3. 导入器与前端

- [ ] 3.1 seller-partner adapter v2 五平台写入路径与标识校验（含 JAN EAN-13 校验、乐天认可集隔离、TEMU 编号校验）。
- [ ] 3.2 前端市场筛选扩展与文案。

## 4. 验收

- [ ] 4.1 专项测试 + 全量 npm test 真实退出码。
- [ ] 4.2 db:verify / 守卫 / openspec strict 全绿。
