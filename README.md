# Acceptances

个人本机使用的验证报告归档工具。Agent 在业务目录执行验证，通过 CLI 保存报告与证据；用户在 Web 查看 Project → Campaign → Run，补充说明、接受、拒绝或作废。

Go 同时提供 API 和 React Web。SQLite 和附件使用一个持久卷，不需要账号、token、外部数据库或对象存储。保存成功不代表人工接受；局部复验不会自动合并历史通过结果。

## 本机启动

在仓库根执行：

```sh
docker compose -f deploy/compose.yaml up --build -d
```

打开 <http://127.0.0.1:8765> 创建 Project。首次启动自动初始化和迁移，服务仅绑定本机端口。应用以非 root 用户运行，代码层只读；数据保存在 `acceptances_app-data` 卷中。普通重启或 `down` 保留数据，不要使用 `down -v`，除非确实要删除该项目全部记录。

```sh
curl --fail http://127.0.0.1:8765/health/ready
docker compose -f deploy/compose.yaml restart app
```

旧版数据和协议不迁移。替换旧安装前先核对容器的 Compose 项目标签及其挂载卷，只清理确认属于旧 Acceptances 的资源。新版不读取旧密码文件，业务仓库不挂载进容器。

## 关联业务项目

安装锁定的 Go、Node 和 pnpm 后，在本仓库执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
make build
make install-skill
```

安装器交付新版 CLI 和 `acceptances-v1` skill，具体安装位置与覆盖行为见安装器提示。切换到业务目录，在加载新版 skill 的聊天中说：

> 使用 $acceptances-v1，将当前仓库关联到已有项目，并验证这次需求。需求依据是……，验证环境是……。

首次由 skill 选择已有 Project，后续复用宿主机关联。同仓库 worktree 共用关联，多个仓库可关联同一个 Project。日常调用无需源码路径、UUID 或凭据。验证任务不自动授权修改业务代码或作出人工接受决定。

操作流程见 [Agent 接入](docs/agents/v1-integration.md)。

## 开发和验证

工具版本由 `toolchain.lock.json`、`go.mod` 和 `pnpm-lock.yaml` 固定。

```sh
make dev
make fmt
make lint typecheck build
make test
make test SUITE=agent
make test SUITE=platform
```

开发 Web 为 <http://127.0.0.1:5173>，API 为 <http://127.0.0.1:8765>，开发数据默认在 `.cache/dev-data`。开发时 CLI 使用 `ACCEPTANCES_URL=http://127.0.0.1:5173`，与 Web 共用 Vite 代理入口。生产构建输出 `build/server`、`build/acceptances` 和 `apps/web/dist`。

`make test` 执行隔离 Go 测试，不能代替真实 Docker 和浏览器验收。命令边界见 [工具链](docs/toolchain.md)，T1–T9 验证步骤见 [实现交接](docs/v1-implementation-handoff.md)。

## 目录

| 目录                        | 职责                               |
| --------------------------- | ---------------------------------- |
| cmd/server、cmd/acceptances | 服务和 CLI 入口                    |
| internal                    | 报告、SQLite、本地证据与 HTTP 实现 |
| apps/web                    | React Web                          |
| packages/api-client         | Web 使用的 HTTP 客户端与类型       |
| deploy                      | 单容器构建和 Compose               |
| skills/acceptances-v1       | 宿主机 Agent 接入                  |

领域词汇见 [GLOSSARY](GLOSSARY.md)，架构决策见 [ADR-0001](docs/adr/0001-local-report-archive.md)。旧 V1 文档及 Git 历史保留为历史依据，不用于补回已删除能力。

## 许可与分发状态

本仓库按内容区分许可，没有覆盖全仓的统一 MIT 授权。入口为 [LICENSE](LICENSE)，逐文件／目录和混合内容范围见 [LICENSE-SCOPE.md](LICENSE-SCOPE.md)，来源与修改说明见 [NOTICE](NOTICE)。

LobeHub 模板／文档沿用及部分 validator 规则改写保留固定提交 `1c7a7116313bcc2d675937139554a244f7adf7a0` 的 [Community License](LICENSES/LobeHub-Community-1c7a711.txt)和 [Apache 2.0 正文](LICENSES/Apache-2.0.txt)，上游生产者与版权人保持原名；混合文件新增表达与旧 renderer 未确定边界列为待核实。新 V1 基础工程只有经证据确认有权授权的原创内容才采用 MIT，候选 MIT 版权署名已确认为 `Copyright (c) 2026 acceptances`，具体原创授权范围仍待确认，项目原创 MIT 生效范围为空。依赖和第三方材料继续遵守各自许可。

尚未公开发行；公开分发范围与条件未确认，A35 仍 blocked；本地精简版运行验收单独记录。这不是全仓 OSI 开源声明，也不代表上游已授予额外授权。与 LobeHub 无隶属或合作关系。
