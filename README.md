# Acceptances V1

面向个人、本机 Docker 部署的验收系统，采用 React/TypeScript + Go + PostgreSQL monorepo。执行结果、证据校验、验收就绪与人工决定分别记录；测试由外部 Agent/CI 执行。

**当前为工单 12–18 的 local V1 实现候选，尚待外部运行验收。** 已加入文件契约、PostgreSQL/身份认证、定义和计划、local 上传封存、覆盖率与人审、CLI 和 Web。R2/OSS 属于工单 19；运维完整配置与备份属于工单 20。`/health/live` 只表示存活；`/health/ready` 在数据库迁移、所有者初始化和目录检查通过后返回 200。

## 开发

精确版本：Go 1.26.8、Node 26.7.0、pnpm 12.4.2、TypeScript 5.9.3、PostgreSQL 18.6。安装匹配版本后执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
make generate
make dev
```

Web：<http://127.0.0.1:5173>；Go：<http://127.0.0.1:8765>。开发命令启动两个进程，不启动数据库、不迁移数据。需要业务能力时先显式配置/迁移隔离开发数据库并初始化所有者；开发浏览器和 CLI 统一经 5173 代理访问（CLI 设置 `ACCEPTANCES_URL=http://127.0.0.1:5173`），开发服务的 Host/Origin 固定为该地址。

```sh
make fmt
make lint typecheck build
./build/acceptances version --json
./build/server
```

生产构建输出 `build/server`、`build/acceptances` 和 `apps/web/dist`。server 从仓库根运行，或显式传 `--web-dir <构建目录>`。CLI 提供 `validate`、`publish`、`status`、`feedback`、`check`；Agent 应使用 `--json` 和固定 UUID。静态检查和构建不包含产品测试。

## Docker 与初始化

密码和 Compose 环境文件都放在仓库外。Compose 环境文件只保存密码文件的绝对路径，不保存密码内容。首次设置时执行：

```sh
mkdir -p "$HOME/.config/acceptances"
chmod 700 "$HOME/.config/acceptances"
if [ ! -e "$HOME/.config/acceptances/postgres-password" ]; then
  (umask 077; openssl rand -hex 32 > "$HOME/.config/acceptances/postgres-password")
fi
chmod 600 "$HOME/.config/acceptances/postgres-password"
if [ ! -e "$HOME/.config/acceptances/compose.env" ]; then
  (umask 077; printf 'ACCEPTANCES_POSTGRES_PASSWORD_FILE=%s/.config/acceptances/postgres-password\n' "$HOME" > "$HOME/.config/acceptances/compose.env")
fi
chmod 600 "$HOME/.config/acceptances/compose.env"
```

分别构建 app 镜像并启动服务：

```sh
make docker-build
make docker-up
```

也可以用一个命令连续完成构建和启动：

```sh
make docker-rebuild
```

首次启动会在专用卷初始化 PostgreSQL。`make docker-up` 先用一次性 root 容器把宿主 mode 600 的数据库密码挂载复制为 app-data 中仅 UID 10001 可读的秘密文件，然后启动非 root 应用；该步骤不打印密码。Compose 文件挂载 secret 的 uid/mode 不能代替这一步。首次启动后显式执行：

```sh
make docker-migrate
make docker-init-owner
curl --fail http://127.0.0.1:8765/health/ready
```

`docker-init-owner` 交互输入用户名和密码，重复初始化返回冲突，不覆盖已有所有者。应用启动不会自动迁移。数据库尚未迁移或所有者未初始化时 readiness 为 503。仅应用端口绑定 `127.0.0.1:8765`，数据库不发布宿主端口。应用非 root、代码层只读。PostgreSQL 18 的卷挂载 `/var/lib/postgresql`。数据库初始化后修改密码文件不会自动修改已有数据库密码。不要复用旧数据库卷或将该基础服务暴露到公网。

## 目录

| 目录                        | 职责                                      |
| --------------------------- | ----------------------------------------- |
| cmd/server、cmd/acceptances | Go 服务与 CLI 入口                        |
| internal                    | 协议、领域、身份、存储和 HTTP 实现        |
| apps/web                    | React SPA                                 |
| packages/api-client         | 从 OpenAPI 生成的前端类型和 HTTP 客户端   |
| contracts                   | OpenAPI、JSON Schema、原始文件与 JCS 夹具 |
| db                          | 编号 goose 迁移和 sqlc 查询               |
| deploy                      | Dockerfile 与 Compose                     |

统一命令、锁定依据和外部验证步骤见 [工具链与交接](docs/toolchain.md)。现有项目与 Agent 的文件发布流程见 [V1 Agent 接入](docs/agents/v1-integration.md)，本次范围与未完成验收见 [12–18 交接](docs/v1-implementation-handoff.md)。

旧 CLI 入口 `bin/cli.js` 已移除。旧 Node 服务、`web/`、Bun 锁文件和根 Vite/TS 配置暂存原处，退出默认构建，不做 V1 兼容；旧说明原文见 [历史 README](README.legacy.md)，其中旧 CLI 命令不再可用。不迁移或删除用户已有 `.acceptances` 数据。旧 skill 尚未接入 V1，不能用于证明新协议支持。

## 许可与分发状态

本仓库按内容区分许可，没有覆盖全仓的统一 MIT 授权。入口为 [LICENSE](LICENSE)，逐文件／目录和混合内容范围见 [LICENSE-SCOPE.md](LICENSE-SCOPE.md)，来源与修改说明见 [NOTICE](NOTICE)。

LobeHub 模板／文档沿用及部分 validator 规则改写保留固定提交 `1c7a7116313bcc2d675937139554a244f7adf7a0` 的 [Community License](LICENSES/LobeHub-Community-1c7a711.txt)和 [Apache 2.0 正文](LICENSES/Apache-2.0.txt)，上游生产者与版权人保持原名；混合文件新增表达与旧 renderer 未确定边界列为待核实。新 V1 基础工程只有经证据确认有权授权的原创内容才采用 MIT，候选 MIT 版权署名已确认为 `Copyright (c) 2026 acceptances`，具体原创授权范围仍待确认，项目原创 MIT 生效范围为空。依赖和第三方材料继续遵守各自许可。

尚未公开发行；公开分发范围与条件未确认，A35 仍 blocked；工单 12–18 正在实现与验收交接，尚未关闭。这不是全仓 OSI 开源声明，也不代表上游已授予额外授权。与 LobeHub 无隶属或合作关系。
