# Acceptances

个人本机使用的验证报告归档工具。Agent 在业务目录执行验证，通过 CLI 保存报告与证据；用户在 Web 查看 Project → Campaign → Run，逐项人工评审、评论或作废。

Go 同时提供 API 和 React Web。SQLite 和附件使用一个持久卷，不需要账号、token、外部数据库或对象存储。全部检查项人工通过才整轮通过；只有最新完整范围 Run 全部人工通过，需求才整体通过。保存成功与 Agent 检查通过分别显示，局部复验不合并历史结果。

## 本机启动

首次使用时在仓库根执行。已有本地运行库升级先按下方说明核对目标并保存一致备份，再运行启动命令：

```sh
docker compose -f deploy/compose.yaml up --build -d
```

打开 <http://127.0.0.1:8765> 创建 Project。首次启动自动初始化和迁移，服务仅绑定本机端口。应用以非 root 用户运行，代码层只读；数据保存在 `acceptances_app-data` 卷中。普通重启或 `down` 保留数据，不要使用 `down -v`，除非确实要删除该项目全部记录。

```sh
curl --fail http://127.0.0.1:8765/health/ready
docker compose -f deploy/compose.yaml restart app
```

本次逐项评审升级会增量迁移当前本地 SQLite，保留报告、证据和旧评审。旧整轮接受、拒绝只作历史，已有非作废 Run 的各项从待审开始，作废状态保持不变；以后重启不会重复清空人工判断。

升级日常运行库前，先核对容器的 Compose 项目标签和挂载卷，停止应用写入，备份完整的 `/var/lib/acceptances` 数据目录，包括 SQLite 相关文件及 `evidence`，再启动新版。保留可恢复备份，不删除或重建持久卷。具体核对步骤见[实施交接](docs/v1-implementation-handoff.md)。更早的旧架构协议与数据导入仍不支持；业务仓库不挂载进容器。

## 关联业务项目

安装锁定的 Go、Node 和 pnpm 后，在本仓库执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
make build
make install-skill
```

安装器交付新版 CLI 和 `acceptances-v1` skill，已有安装时默认拒绝覆盖。替换旧版 CLI 和 skill，在本仓库执行 `make replace-skill`（等价于 `python3 scripts/v1/install-skill.py --replace`）。安装路径以命令输出为准。

切换到业务目录，在加载新版 skill 的聊天中说：

> 使用 $acceptances-v1，将当前仓库关联到已有项目，并验证这次需求。需求依据是……，验证环境是……。

首次由 skill 选择已有 Project，后续复用宿主机关联。同仓库 worktree 共用关联，多个仓库可关联同一个 Project。日常调用无需源码路径、UUID 或凭据。验证任务不自动授权修改业务代码或作出人工接受决定。

操作流程见 [Agent 接入](docs/agents/v1-integration.md)。

## 人工反馈后再次验证

在 Web 对每项通过、不通过、撤回或评论。人工不通过必填理由；Agent 原始结果为失败、阻塞或跳过时人工通过也必填理由。评论不改状态，发现问题需要明确改判；系统立即重算本轮状态。

在原业务聊天中发送：

> 使用 $acceptances-v1，读取 Campaign「需求名称」中 Run「ID」的逐项人工判断和评论。授权修复当前人工不通过项及本次指定的新问题，执行复验和必要回归。保留原始验证结果，实际完成后在同一 Campaign 保存新 Run，明确完整或局部范围，逐条关联来源反馈、处理说明及本次检查项，交给我再次评审。

Agent 使用 `acceptances feedback --campaign <标题或ID>` 读取反馈，`acceptances status --run <ID>` 核对指定 Run。人工通过的项不因 Agent 原来判断失败就自动进入修复范围。未处理或受阻如实说明，新 Run 各项重新待审；局部 Run 通过后需求整体仍待审。保存评论不会自动触发 Agent。

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

开发 Web 为 <http://127.0.0.1:5173>，API 为 <http://127.0.0.1:8765>，开发数据默认在 `.cache/dev-data`。开发时在业务目录首次关联使用 `acceptances link --url http://127.0.0.1:5173 --project <项目名称>`，与 Web 共用 Vite 代理入口；后续命令复用关联中保存的 URL。生产构建输出 `build/server`、`build/acceptances` 和 `apps/web/dist`。

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

领域词汇见 [GLOSSARY](GLOSSARY.md)，架构决策见 [ADR-0001](docs/adr/0001-local-report-archive.md) 和[逐项评审决策](docs/adr/0002-per-check-human-review.md)。旧 V1 文档及 Git 历史保留为历史依据，不用于补回已删除能力。

## 许可与分发状态

本仓库按内容区分许可，没有覆盖全仓的统一 MIT 授权。入口为 [LICENSE](LICENSE)，逐文件／目录和混合内容范围见 [LICENSE-SCOPE.md](LICENSE-SCOPE.md)，来源与修改说明见 [NOTICE](NOTICE)。

LobeHub 模板／文档沿用及部分 validator 规则改写保留固定提交 `1c7a7116313bcc2d675937139554a244f7adf7a0` 的 [Community License](LICENSES/LobeHub-Community-1c7a711.txt)和 [Apache 2.0 正文](LICENSES/Apache-2.0.txt)，上游生产者与版权人保持原名；混合文件新增表达与旧 renderer 未确定边界列为待核实。新 V1 基础工程只有经证据确认有权授权的原创内容才采用 MIT，候选 MIT 版权署名已确认为 `Copyright (c) 2026 acceptances`，具体原创授权范围仍待确认，项目原创 MIT 生效范围为空。依赖和第三方材料继续遵守各自许可。

尚未公开发行；公开分发范围与条件未确认，A35 仍 blocked；本地精简版运行验收单独记录。这不是全仓 OSI 开源声明，也不代表上游已授予额外授权。与 LobeHub 无隶属或合作关系。
