# Acceptances

个人本机使用的验证报告归档工具。Agent 在业务目录执行验证，通过 CLI 保存报告与证据；用户在 Web 查看 Project → Campaign → Run，逐项人工评审、评论或作废。

Go 同时提供 API 和 React Web，MySQL 保存业务元数据、证据与离线文档的完整内容。本地开发由 Docker 提供 MySQL，不需要产品账号、token 或对象存储。全部检查项人工通过才整轮通过；只有最新完整范围 Run 全部人工通过，需求才整体通过。保存成功与 Agent 检查通过分别显示，局部复验不合并历史结果。

## 本机启动

首次使用时在仓库根执行。已有本地运行库升级先按下方说明核对目标并保存一致备份，再运行启动命令：

```sh
make docker-up
```

打开 <http://127.0.0.1:8765> 创建 Project。全新数据首次启动自动初始化；已有数据按 [MySQL 存储与恢复](docs/mysql-storage.md) 核对目标并保存一致备份。服务仅绑定本机端口。应用以非 root 用户运行，代码层只读；业务和完整文件保存在 `acceptances_mysql-data`。普通重启或 `down` 保留数据，不要使用 `down -v`，除非明确要删除该项目全部记录。

```sh
curl --fail http://127.0.0.1:8765/health/ready
docker compose -f deploy/compose.yaml restart app
```

当前版本仅使用 MySQL，不提供 SQLite 启动、升级或导入。旧 MySQL 附件可通过 `make dev-stop` → `make mysql-files-migrate` → `make dev-up` 迁入数据库；完整数据库备份包含全部文件。保留当前凭据和必要备份，详见 [MySQL 存储与恢复](docs/mysql-storage.md)。

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

## 冻结正式交付与业务说明

在实际验证报告发布前，项目侧 Agent 按[正式交付材料](skills/acceptances-v1/references/delivery.md)准备需求、地图、说明素材、真实构建及截图，以普通附件随报告整包保存。完成最新完整 Run 的全部人审后，点击“冻结正式交付”，确认版本、必验范围、说明内容与敏感信息检查；原始未通过项须有具体接受理由。

冻结快照保存当时结论及独立证据副本。绑定 Run 的改判、撤回、作废或删除让交付失效，原内容保留；再次接受不会自动恢复。新一轮自待审，新的明确冻结才替代旧版本。首页“交付归档”可查看效力历史，来源 Project/Campaign/Run 删除后仍可访问归档。

有效交付详情可生成业务说明，平台确定性渲染带内嵌图片的离线 HTML，无服务端 LLM。说明版本独立，可预览、下载及失败重试，不回写 Run 或快照。协议见[交付 API](contracts/delivery.md)。本轮源码实现不自动升级已有容器、CLI 或已安装 skill。

## 人工反馈后再次验证

在 Web 对每项通过、不通过、撤回或评论。人工不通过必填理由；Agent 原始结果为失败、阻塞或跳过时人工通过也必填理由。评论不改状态，发现问题需要明确改判；系统立即重算本轮状态。

在原业务聊天中发送：

> 使用 $acceptances-v1，读取 Campaign「需求名称」中 Run「ID」的逐项人工判断和评论。授权修复当前人工不通过项及本次指定的新问题，执行复验和必要回归。保留原始验证结果，实际完成后在同一 Campaign 保存新 Run，明确完整或局部范围，逐条关联来源反馈、处理说明及本次检查项，交给我再次评审。

Agent 使用 `acceptances feedback --campaign <标题或ID>` 读取反馈，`acceptances status --run <ID>` 核对指定 Run。人工通过的项不因 Agent 原来判断失败就自动进入修复范围。未处理或受阻如实说明，新 Run 各项重新待审；局部 Run 通过后需求整体仍待审。保存评论不会自动触发 Agent。

## 开发和验证

工具版本由 `toolchain.lock.json`、`go.mod` 和 `pnpm-lock.yaml` 固定。

```sh
make dev                  # 自动启动 Docker MySQL，前台启动 Go/Vite，Ctrl-C 清理应用
# 或 make dev-up 后台启动；make dev-status 查询；make dev-stop 停止
make fmt
make lint typecheck build
make test
make test SUITE=mysql
make test SUITE=agent
make test SUITE=platform
```

开发 Web 为 <http://127.0.0.1:5173>，API 为 <http://127.0.0.1:8765>，附件默认在 `.cache/dev-data`，数据库使用 `127.0.0.1:3307/acceptances_dev` 的 Docker MySQL。开发时在业务目录首次关联使用 `acceptances link --url http://127.0.0.1:5173 --project <项目名称>`，与 Web 共用 Vite 代理入口；后续命令复用关联中保存的 URL。也可分开配置 `acceptances link --url http://127.0.0.1:8765 --web-url http://127.0.0.1:5173 --project <项目名称>`：API 请求使用 `--url`，人审回执使用 `--web-url`；同源部署不需要额外配置。旧关联可重新 link 更新地址，`acceptances status --run <ID>` 只读返回正确人审链接。生产构建输出 `build/server`、`build/acceptances` 和 `apps/web/dist`。

`make test` 执行隔离 Go 测试、Web 单元及服务生命周期回归。`make services-status` 查询受管开发/验证服务，`make services-stop` 停止它们（会中断验证）；真实开发启动/退出烟测使用 `make test SUITE=services`。`pnpm test:browser` 构建当前源码，再执行已有真实浏览器回归；分组与证据边界见 [Web 回归验证](apps/web/tests/README.md)。这些检查不能代替真实业务及 Docker 验收。命令边界见 [工具链](docs/toolchain.md)，T1–T9 验证步骤见 [实现交接](docs/v1-implementation-handoff.md)。

## 目录

| 目录                        | 职责                              |
| --------------------------- | --------------------------------- |
| cmd/server、cmd/acceptances | 服务和 CLI 入口                   |
| internal                    | 报告、MySQL、归档文件与 HTTP 实现 |
| apps/web                    | React Web                         |
| packages/api-client         | Web 使用的 HTTP 客户端与类型      |
| deploy                      | 应用与 MySQL 的构建和 Compose     |
| skills/acceptances-v1       | 宿主机 Agent 接入                 |

领域词汇见 [GLOSSARY](GLOSSARY.md)，架构决策见 [ADR-0001](docs/adr/0001-local-report-archive.md) 和[逐项评审决策](docs/adr/0002-per-check-human-review.md)。旧 V1 文档及 Git 历史保留为历史依据，不用于补回已删除能力。

## 许可与分发状态

本仓库按内容区分许可，没有覆盖全仓的统一 MIT 授权。入口为 [LICENSE](LICENSE)，逐文件／目录和混合内容范围见 [LICENSE-SCOPE.md](LICENSE-SCOPE.md)，来源与修改说明见 [NOTICE](NOTICE)。

LobeHub 模板／文档沿用及部分 validator 规则改写保留固定提交 `1c7a7116313bcc2d675937139554a244f7adf7a0` 的 [Community License](LICENSES/LobeHub-Community-1c7a711.txt)和 [Apache 2.0 正文](LICENSES/Apache-2.0.txt)，上游生产者与版权人保持原名；混合文件新增表达与旧 renderer 未确定边界列为待核实。新 V1 基础工程只有经证据确认有权授权的原创内容才采用 MIT，候选 MIT 版权署名已确认为 `Copyright (c) 2026 acceptances`，具体原创授权范围仍待确认，项目原创 MIT 生效范围为空。依赖和第三方材料继续遵守各自许可。

尚未公开发行；公开分发范围与条件未确认，A35 仍 blocked；本地精简版运行验收单独记录。这不是全仓 OSI 开源声明，也不代表上游已授予额外授权。与 LobeHub 无隶属或合作关系。
