# Design: GitHub Independent Production Health Monitor

GitHub Actions 每小时从独立基础设施访问固定 HTTPS `/ready`。只有 HTTP 200、`data.status=ready`、所有 required checks 为 `ok` 且存在非空 `meta.request_id` 才视为健康；任何网络、超时、非 200、过大或畸形响应统一映射为固定原因。`/health` 仅代表 liveness，不能作为 readiness 或 Production GO 证据。

工作流只授予 `contents: read` 与 `issues: write`，Action 使用提交 SHA 固定。GitHub Token 只进入 Authorization header，不写日志、Issue 或文件。固定标题保证一个开放故障只对应一个 Issue；并发组避免同一时间重复处理。

手动 `failure` 与 `recovery` 模式不访问生产端点，分别验证 Issue 创建/重新打开与恢复关闭。正常故障仍让工作流失败，使 Actions 页面同时保留红色运行证据；真实 current-SHA `/ready` 与连续 operator observation 必须另获授权和回读。

仓库发布门禁把该文件列为唯一允许的工作流，并检查固定端点、小时级计划、最小权限、固定脚本以及不存在 push、pull request 或部署入口。这样增加外部健康探测不会同时获得发布权限。
