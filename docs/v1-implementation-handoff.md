# 工单 12–18 实现交接

本次按用户指定顺序 12 → 13 → 14 → 15 → 17 → 16 → 18 实施。代码是工作区候选，不是已验收发布；没有提交、推送、公开发布、迁移或清理日常数据。

## 范围与入口

| 工单 | 工作区实现                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| 12   | contracts/schemas 与 OpenAPI；严格 JSON、JCS、原始 SHA-256、路径/引用规则、离线 bundle、dirty 指纹采集、合成夹具      |
| 13   | pgx/goose/sqlc、四份编号迁移；所有者初始化/密码重置、会话/CSRF/Host/Origin、Project/Repository/token、授权事务再检查  |
| 14   | definitions/Plan/Target 原文导入与不可变版本，跨项目关系约束，Campaign 当前依据 CAS                                   |
| 15   | Run/修订、草稿更新、上传/续传/封存、幂等、generation、DB lease/fence、两 worker、预算与超时、失败重试、7 天候选清理   |
| 17   | 服务端评估、显式前驱叶覆盖、冲突选择、评估采用、固定 Snapshot、人审事件/拒绝解决、ready/accepted 门禁、资产完整性失效 |
| 16   | validate/publish/status/feedback/check、token 文件、JSON/退出码、重试稳定 IDs、等待超时后查持久状态                   |
| 18   | 所有者登录、项目/仓库/token/Campaign、Run/修订路径、只读 Plan/Target、证据预览、人审历史、过期会话保留输入、冲突刷新  |

生成入口为 `make generate`；Go 依赖锁在 go.mod/go.sum，工具/镜像锁在 toolchain.lock.json。Docker 显式迁移和账号初始化见 README；现有 Agent 接入见 [接入步骤](agents/v1-integration.md)。未修改旧 skill、未自动升级本机全局 CLI、未复用旧 Round 数据。云存储与完整运维分别留在 19/20。

## 已执行检查与证据边界

- 已执行生成、格式化、lint、TypeScript 类型检查和原生构建；命令日志、源码清单与二进制摘要记录在 [静态检查记录](../.scratch/open-source-v1/verification/implementation-12-18/static-checks.json)。该记录不属于产品运行证据。
- `go test ./internal/... -run '^$'` 仅编译测试代码，没有执行产品测试。
- 未执行数据库迁移、实际发布、Docker 镜像运行或真实浏览器验收；没有相应通过记录。
- Docker socket 读取在当前沙箱受限，未绕过权限或操作已有卷。

工单原规格要求全部产品测试由外部 Agent/CI 执行。当前已询问用户是否允许实施者在隔离目录与专用卷运行这些测试，答复前保持此边界。工单保持 claimed；未运行不能记为通过。

## 外部验证命令

使用隔离候选 checkout，归档 commit、完整 dirty 源码快照、生成文件与二进制 SHA-256。先运行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
make generate
make lint typecheck build
ACCEPTANCES_EXTERNAL_CI=1 make test SUITE=contract
ACCEPTANCES_EXTERNAL_CI=1 make test SUITE=domain
ACCEPTANCES_EXTERNAL_CI=1 make test SUITE=cli
ACCEPTANCES_EXTERNAL_CI=1 make test SUITE=platform
```

postgres/storage-local 使用独立 PostgreSQL 18.6 服务，每次测试创建一个全新 `acceptances_test_<作业标识>` 数据库，至少 20 GiB 可用磁盘；数据库 URL 通过秘密环境注入，不写仓库、日志或产物。设置 `ACCEPTANCES_TEST_DATABASE_URL` 和 `ACCEPTANCES_TEST_ISOLATED=1`，然后分别执行：

```sh
ACCEPTANCES_EXTERNAL_CI=1 make test SUITE=postgres
# 下一个分组必须换一个全新的专用数据库。
ACCEPTANCES_EXTERNAL_CI=1 make test SUITE=storage-local
```

集成测试拒绝已有 projects 表，保留数据库用于失败诊断，不 drop/truncate。它覆盖真实 PostgreSQL 加进程内 HTTP 的初始化、原文幂等、未完成资产拒绝封存、合法业务失败封存、不满足 ready 和单范围读取。其余并发、撤销、崩溃恢复、容量/超时和跨项目矩阵需外部补齐；不得用这一测试宣称整个工单完成。

## 真实服务与浏览器闭环

在专用 Compose 项目名、密码文件和卷中执行 README 的构建/初始化步骤，不能运行日常卷的 down -v。记录镜像摘要、运行平台、app UID、端口绑定、readiness、接口日志；隐藏所有秘密。至少完成：

1. 登录创建 Project/Repository/Campaign、默认期限 token；机器 token 不能人审或读取未授权原始证据。
2. 对测试业务项目生成实际失败 bundle，CLI 发布；Web 能看到事实/封存状态，ready 门禁失败，所有者拒绝。
3. 业务修复后用新 Run 和显式 supersedes 发布真实通过证据；解决拒绝事件并审阅当前 Snapshot，所有者接受后严格 accepted 门禁通过。
4. 同一 Run 新 Revision 只纠错报告，旧人工决定不被套用到变化后的 Snapshot；并行叶结果展示冲突。
5. 验证旧页面 If-Match 冲突保留输入、历史决定、会话过期、跨项目 token、危险 MIME 只下载、文本转义、音视频单范围、资产丢失或篡改禁止接受。

e2e 由 `make test SUITE=e2e` 调用外部真实浏览器驱动。设置 `ACCEPTANCES_E2E_RUNNER` 为可执行文件绝对路径、`ACCEPTANCES_E2E_URL` 为专用本机服务地址，并设置 `ACCEPTANCES_EXTERNAL_CI=1 ACCEPTANCES_TEST_ISOLATED=1`。驱动接收 `--base-url <origin> --receipt <absolute-json-path>`，写出 steps 数组，每项有 name、outcome=passed、evidence 文件路径数组；文件放 artifacts 内。

必需步骤名为 failure-rejection、new-run-acceptance、report-correction、stale-basis、cross-project、expired-session、unsafe-and-missing-evidence。入口验证源码未变化、回执齐全并记录证据 SHA-256；它不能替代驱动真实执行，必须归档驱动代码/版本、截图、网络和断言记录。报告分别标记静态、合成、真实数据库、部署服务和真实浏览器，按 `.scratch/open-source-v1/specs/verification.md` 的 A01–A35 逐项记录通过、失败、未运行。A35 的授权与分发限制继续保持 blocked。

## 尚待确认的实现与验证缺口

- 候选复用和清理已加入逐对象摘要复核、过期草稿判断、持久删除标记与 sealed/文档/评估/Snapshot 引用保护；崩溃和并发故障注入尚待运行验证。
- 旧孤立 candidate 仅在同一修订/generation/逻辑资产、无原活动写租约且完整摘要匹配时复用；保持跨修订不去重，新在途候选排他。
- OpenAPI 已改为专用输出 DTO；文档 Go DTO 从同一 JSON Schema 生成。HTTP 响应与生成类型的一致性仍须契约运行测试核对。
- reevaluate 已进入 PostgreSQL 持久任务，返回固定 Evaluation ID 与状态地址；租约和授权撤销检查复用发布任务边界，运行证据待回填。
- e2e 入口已接外部驱动回执；实际驱动、完整 dirty 指纹矩阵和各工单故障注入矩阵尚待外部执行与补齐。

以上缺口与未运行测试均不标记完成，12–18 不关闭。
