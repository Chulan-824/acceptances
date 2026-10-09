# 工具链与外部验证交接

## 锁定范围

`toolchain.lock.json` 锁定运行时、镜像 manifest digest 和后续 Go 工具/SDK 的预留版本；`pnpm-lock.yaml` 锁定当前 JS 依赖树及完整性摘要。Go 模块由 go.mod/go.sum 锁定，已接入 pgx、goose、JSON Schema 校验器、Argon2id 和终端密码读取；sqlc v1.31.1 是固定版本的生成工具。

- Go 1.26.8：采用已核实的 1.26 维护补丁。Make 使用精确 GOTOOLCHAIN，缓存位于 `.cache/`；首次使用可能下载工具链。
- Node 26.7.0 / pnpm 12.4.2：与当前开发机版本一致；packageManager、engines、.node-version 和构建镜像对齐。
- TypeScript 5.9.3：openapi-typescript 7.13.0 要求 TypeScript ^5.x；保持 strictPeerDependencies，不豁免 peer 冲突。
- React 19.2.8、Vite 8.2.2、插件及 ESLint 沿用已有版本并精确锁定。
- PostgreSQL 18.6：镜像采用 bookworm，卷根为 `/var/lib/postgresql`。
- pgx v5.11.0、goose v3.28.0、JSON Schema 校验器 v6.0.3 已接入；sqlc v1.31.1 已生成并使用控制行查询。AWS S3/OSS SDK 仍是工单 19 的预留版本。

核实来源：[Go 发布记录](https://go.dev/doc/devel/release)、[Vite 环境要求](https://vite.dev/guide/)、[pnpm 安装支持](https://pnpm.io/installation)、[TypeScript 元数据](https://registry.npmjs.org/typescript/5.9.3)、[OpenAPI 生成器元数据](https://registry.npmjs.org/openapi-typescript/7.13.0)、[PostgreSQL 官方镜像](https://hub.docker.com/_/postgres)、[Go 模块代理](https://proxy.golang.org/)、[AWS Go SDK](https://docs.aws.amazon.com/sdk-for-go/v2/developer-guide/welcome.html)、[OSS Go SDK](https://github.com/aliyun/alibabacloud-oss-go-sdk-v2)。核实日期及镜像 digest 见锁文件。

## 命令边界

| 命令                     | 作用                                                         |
| ------------------------ | ------------------------------------------------------------ |
| make dev                 | 启动 Go API 与 Vite，Ctrl-C 停止两者；无数据库操作           |
| make generate            | 从 OpenAPI 生成 TS、Schema 生成 Go DTO、SQL 生成 sqlc        |
| make fmt                 | 仅新工程与明确列出的根配置，排除旧代码、规划和用户数据       |
| make lint                | 格式检查、ESLint、go vet；不运行产品测试                     |
| make typecheck           | Web 与 API client TypeScript 检查                            |
| make build               | 当前平台 Go 两个二进制和 Web 产物                            |
| make test SUITE=platform | 外部 Agent/CI 的原生进程烟测；需要 ACCEPTANCES_EXTERNAL_CI=1 |

当前没有默认测试集合，未指定或未知分组会返回非零，不能把未实现分组记为通过。CI 标志只防误调用，不是权限认证。生成结果位于 `packages/api-client/src/schema.d.ts` 与 `internal/database/queries`；生成后检查差异，不能用手改生成文件掩盖契约变化。Docker 使用已生成并经 CI 核对的文件。

## 外部 Agent/CI 精确交接

以下步骤尚待外部执行，不是本机验证结果。使用隔离 checkout，不读取真实项目秘密：

```sh
pnpm install --frozen-lockfile --ignore-scripts
make generate
# 对已提交候选检查：生成后必须无差异；未提交候选另存源码快照和摘要。
git diff --exit-code -- packages/api-client/src/schema.d.ts
make lint typecheck build
ACCEPTANCES_EXTERNAL_CI=1 make test SUITE=platform
```

在 macOS/Linux 的 amd64/arm64 **真实运行环境**分别执行，归档 `artifacts/platform.json`、日志、源码 commit/dirty 快照与产物 SHA-256。脚本只验证当前平台的 CLI、HTTP 与静态资源、正常停机；不代表其他平台、数据库、Docker 或浏览器通过。

Docker 另在 Linux amd64/arm64 隔离执行：创建独立密码文件，设置 `ACCEPTANCES_POSTGRES_PASSWORD_FILE`；运行 README 中 Compose 命令。检查数据库无宿主端口、app 非 root、PG 卷根、进程健康及迁移/所有者初始化前 readiness=503，初始化后 readiness=200；归档 Compose 配置（不得包含秘密）、镜像 digest、请求/容器日志和平台信息。结束时只移除该作业明确创建的资源，不删除用户日常卷。需要真实浏览器走完整失败、拒绝、复验和接受闭环，见本次交接。

完整 A34/A35 仍为 pending：平台矩阵、容器运行、浏览器证据与全仓来源/许可证核查不能用静态编译代替。工单 12–18 按用户本次授权实施；各工单等待相应外部证据后关闭。

产品测试入口：`SUITE=agent|agent-process|contract|domain|cli|postgres|storage-local|platform|e2e`，均要求 `ACCEPTANCES_EXTERNAL_CI=1`。postgres/storage-local 还要求 `ACCEPTANCES_TEST_DATABASE_URL` 指向全新的 `acceptances_test_*` 数据库及 `ACCEPTANCES_TEST_ISOLATED=1`。测试不会 drop/truncate 既有数据库；检测到已有 projects 表即失败。每次重跑创建新的专用数据库，不使用日常 Compose 卷。e2e 入口调用外部真实浏览器驱动并校验回执，具体驱动接口见交接。

`SUITE=agent` 构建当前原生 CLI，运行 V1 接入辅助工具、JCS 和本地权限单测。辅助工具 HTTP 为受控本机服务，不能当作 Docker 或真实浏览器验收。新增仓库机器权限的数据库路由矩阵在 postgres 分组中。

`SUITE=agent-process` 使用新的 `acceptances_test_*` 数据库，先检查无 projects 表，再启动真实 Go 进程并用现有 CLI 完成接入、仓库登记、活动复用、失败夹具发布和稳定重试。要求 `ACCEPTANCES_EXTERNAL_CI=1 ACCEPTANCES_TEST_ISOLATED=1 ACCEPTANCES_TEST_DATABASE_URL`；默认使用 psql 检查数据库，Docker 测试服务可指定 `ACCEPTANCES_TEST_POSTGRES_CONTAINER` 使用容器内 psql。该报告明确区分真实服务执行与合成业务输入，不代表浏览器或业务需求通过。
