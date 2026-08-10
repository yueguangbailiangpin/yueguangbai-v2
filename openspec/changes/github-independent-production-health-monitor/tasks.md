# Tasks: GitHub Independent Production Health Monitor

- [x] 冻结独立监控、最小权限、低基数输出与 `NO_SCHEMA_CHANGE`。
- [x] 实现有界 `/health` 检查和单 Issue 故障/恢复状态机。
- [x] 新增固定 SHA、最小权限、并发受控的定时/手动工作流。
- [x] 补离线测试覆盖健康、HTTP/网络失败、去重、恢复和非法端点。
- [x] 更新发布控制审计，仅允许该固定监控工作流并继续拒绝自动部署。
- [ ] 运行严格 OpenSpec、定向测试与整仓门禁。
- [ ] 推送后执行一次真实模拟故障与恢复验收。
