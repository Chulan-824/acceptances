# 工具链与工单 11 交接

## 锁定范围

`toolchain.lock.json` 锁定运行时、镜像 manifest digest 和后续 Go 工具/SDK 的预留版本；`pnpm-lock.yaml` 锁定当前 JS 依赖树及完整性摘要。Go 当前只用标准库，没有外部模块，因此无需 go.sum。后续引入模块时必须同时更新 go.mod/go.sum。

- Go 1.26.8：采用已核实的 1.26 维护补丁。Make 使用精确 GOTOOLCHAIN，缓存位于 `.cache/`；首次使用可能下载工具链。
- Node 26.7.0 / pnpm 12.4.2：与当前开发机版本一致；packageManager、engines、.node-version 和构建镜像对齐。
- TypeScript 5.9.3：openapi-typescript 7.13.0 要求 TypeScript ^5.x；保持 strictPeerDependencies，不豁免 peer 冲突。
- React 19.2.8、Vite 8.2.2、插件及 ESLint 沿用已有版本并精确锁定。
- PostgreSQL 18.6：镜像采用 bookworm，卷根为 `/var/lib/postgresql`。
- pgx/sqlc/goose、JSON Schema 校验器、AWS S3/OSS SDK 只有预留版本，不表示已经安装、生成查询或接通云服务。

核实来源：[Go 发布记录](https://go.dev/doc/devel/release)、[Vite 环境要求](https://vite.dev/guide/)、[pnpm 安装支持](https://pnpm.io/installation)、[TypeScript 元数据](https://registry.npmjs.org/typescript/5.9.3)、[OpenAPI 生成器元数据](https://registry.npmjs.org/openapi-typescript/7.13.0)、[PostgreSQL 官方镜像](https://hub.docker.com/_/postgres)、[Go 模块代理](https://proxy.golang.org/)、[AWS Go SDK](https://docs.aws.amazon.com/sdk-for-go/v2/developer-guide/welcome.html)、[OSS Go SDK](https://github.com/aliyun/alibabacloud-oss-go-sdk-v2)。核实日期及镜像 digest 见锁文件。

## 命令边界

| 命令                     | 作用                                                         |
| ------------------------ | ------------------------------------------------------------ |
| make dev                 | 启动 Go API 与 Vite，Ctrl-C 停止两者；无数据库操作           |
| make generate            | 从当前 OpenAPI 生成 TS 类型并格式化；不生成业务假接口        |
| make fmt                 | 仅新工程与明确列出的根配置，排除旧代码、规划和用户数据       |
| make lint                | 格式检查、ESLint、go vet；不运行产品测试                     |
| make typecheck           | Web 与 API client TypeScript 检查                            |
| make build               | 当前平台 Go 两个二进制和 Web 产物                            |
| make test SUITE=platform | 外部 Agent/CI 的原生进程烟测；需要 ACCEPTANCES_EXTERNAL_CI=1 |

当前没有默认测试集合，未指定或未知分组会返回非零，不能把未实现分组记为通过。CI 标志只防误调用，不是权限认证。生成结果提交在 `packages/api-client/src/schema.d.ts`；生成后检查差异，不能用手改生成文件掩盖契约变化。Docker 使用已生成并经 CI 核对的文件。

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

Docker 另在 Linux amd64/arm64 隔离执行：创建独立密码文件，设置 `ACCEPTANCES_POSTGRES_PASSWORD_FILE`；运行 README 中 Compose 命令。检查数据库无宿主端口、app 非 root、PG 卷根、进程健康及 readiness=503；归档 Compose 配置（不得包含秘密）、镜像 digest、请求/容器日志和平台信息。结束时只移除该作业明确创建的资源，不删除用户日常卷。需要真实浏览器打开页面确认基础提示与 API 版本显示。

完整 A34/A35 仍为 pending：平台矩阵、容器运行、浏览器证据与全仓来源/许可证核查不能用静态编译代替。工单 11 保持 claimed，待外部证据回填后收口；不自动开始依赖它的业务工单。
