# Acceptances V1

面向个人、本机 Docker 部署的验收系统，采用 React/TypeScript + Go + PostgreSQL monorepo。执行结果、证据校验、验收就绪与人工决定分别记录；测试由外部 Agent/CI 执行。

**当前是工程基础阶段，尚不能发布证据或完成人工验收。** 数据库连接/迁移、身份认证、本地/R2/OSS 存储与业务协议尚未接入。`/health/live` 表示进程存活；`/health/ready` 固定返回 503 `FOUNDATION_ONLY`。

## 开发

精确版本：Go 1.26.8、Node 26.7.0、pnpm 12.4.2、TypeScript 5.9.3、PostgreSQL 18.6。安装匹配版本后执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
make generate
make dev
```

Web：<http://127.0.0.1:5173>；Go：<http://127.0.0.1:8765>。开发命令启动两个进程，不启动数据库、不迁移数据。

```sh
make fmt
make lint typecheck build
./build/acceptances version --json
./build/server
```

生产构建输出 `build/server`、`build/acceptances` 和 `apps/web/dist`。server 从仓库根运行，或显式传 `--web-dir <构建目录>`。CLI 当前仅支持帮助和版本查询。静态检查和构建不包含产品测试。

## Docker 基础

准备仓库外的密码文件，限制文件权限，并将绝对路径放入环境变量：

```sh
export ACCEPTANCES_POSTGRES_PASSWORD_FILE=/absolute/path/to/postgres-password
# 首次启动会在专用卷初始化 PostgreSQL；应用尚不连接数据库。
docker compose --env-file /dev/null -f deploy/compose.yaml up --build
```

仅应用端口绑定 `127.0.0.1:8765`，数据库不发布宿主端口。应用非 root、代码层只读。PostgreSQL 18 的卷挂载 `/var/lib/postgresql`。首次初始化之后修改密码文件不会自动修改数据库密码。不要复用旧数据库卷或将该基础服务暴露到公网。

## 目录

| 目录                        | 职责                                           |
| --------------------------- | ---------------------------------------------- |
| cmd/server、cmd/acceptances | Go 服务与 CLI 入口                             |
| internal                    | 共享 Go 实现，后续加入领域与应用层             |
| apps/web                    | React SPA                                      |
| packages/api-client         | 从 OpenAPI 生成的前端类型和 HTTP 客户端        |
| contracts                   | 已实现端点的 OpenAPI，后续加入业务 JSON Schema |
| db                          | 数据库迁移和查询的后续入口                     |
| deploy                      | Dockerfile 与 Compose                          |

统一命令、锁定依据、外部验证步骤见 [工具链与交接](docs/toolchain.md)。后续范围包括验收定义、外部结果导入、证据存储与封存、多轮复验及人审；这些能力尚未在当前基础版本实现。

旧 Node 服务、CLI、`web/`、Bun 锁文件和根 Vite/TS 配置暂存原处，退出默认构建，不做 V1 兼容；旧说明原文见 [历史 README](README.legacy.md)。不迁移或删除用户已有 `.acceptances` 数据。旧 skill 尚未接入 V1，不能用于证明新协议支持。

## 许可与分发状态

本仓库按内容区分许可，没有覆盖全仓的统一 MIT 授权。入口为 [LICENSE](LICENSE)，逐文件／目录和混合内容范围见 [LICENSE-SCOPE.md](LICENSE-SCOPE.md)，来源与修改说明见 [NOTICE](NOTICE)。

LobeHub 模板／文档沿用及部分 validator 规则改写保留固定提交 `1c7a7116313bcc2d675937139554a244f7adf7a0` 的 [Community License](LICENSES/LobeHub-Community-1c7a711.txt)和 [Apache 2.0 正文](LICENSES/Apache-2.0.txt)，上游生产者与版权人保持原名；混合文件新增表达与旧 renderer 未确定边界列为待核实。新 V1 基础工程只有经证据确认有权授权的原创内容才采用 MIT，候选 MIT 版权署名已确认为 `Copyright (c) 2026 acceptances`，具体原创授权范围仍待确认，项目原创 MIT 生效范围为空。依赖和第三方材料继续遵守各自许可。

尚未公开发行；公开分发范围与条件未确认，A35 仍 blocked，工单 12 未启动。这不是全仓 OSI 开源声明，也不代表上游已授予额外授权。与 LobeHub 无隶属或合作关系。
