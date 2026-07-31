# 交给 Codex 的本地初始化指令

将本包解压后，把下面内容发送给 Codex。先把 `<MODULE0_PATH>` 替换成解压目录的绝对路径。

```text
你现在只执行月光白 V2 的本地仓库初始化，不开发业务代码。

来源合同目录：
<MODULE0_PATH>

目标目录：
~/Projects/yueguangbai-v2

强制规则：
1. 如果目标目录已经存在且非空，立即停止并报告，不能覆盖。
2. 不访问或修改旧仓库。
3. 不创建 GitHub 远程仓库，不设置 origin，不 Push。
4. 不登录或操作 Cloudflare、飞书。
5. 不执行 npm install，不访问网络。
6. 不创建真实 wrangler 资源配置，不写资源 ID 或 Secret。
7. 原样复制来源合同文件，不能自行改写内容。

执行：
- 创建 ~/Projects/yueguangbai-v2
- 初始化全新 git
- 原样复制 README.md、AGENTS.md、PROJECT.md、docs/ 和本包中的辅助文件
- 创建空目录：
  apps/api/src
  apps/web/src
  packages/contracts/src
  packages/domain/src
  packages/ui/src
  packages/testkit/src
  migrations
  scripts
  test
  .github/workflows
- 在空目录放置 .gitkeep
- 创建 .gitignore，至少忽略：
  node_modules/
  dist/
  coverage/
  .wrangler/
  .dev.vars
  .env
  .env.*
  !.env.example
  backups/
  tmp/
  *.sqlite
  *.db
  *.log
- 创建一个不含任何资源 ID 的 wrangler.example.jsonc，只说明未来需要 DB、IMAGES 和限流绑定，不得创建 wrangler.jsonc
- 运行：
  git status --short
  git remote -v
  grep -R --line-number -E "9745ba1f|yueguangbai-images|GOOGLE_DRIVE_FOLDER_ID|sk-[A-Za-z0-9_-]{20,}" . || true
- 确认 git remote -v 为空
- 创建本地提交：
  chore: freeze v2 module 0 contracts

返回完整报告：
TASK=
FILES_CHANGED=
COMMANDS_RUN=
GIT_COMMIT=
GIT_REMOTES=
FORBIDDEN_STRING_SCAN=
REMOTE_WRITES=no
CLOUDFLARE_RESOURCES_TOUCHED=no
FEISHU_RESOURCES_TOUCHED=no
GITHUB_REMOTE_TOUCHED=no
OPEN_RISKS=
```
