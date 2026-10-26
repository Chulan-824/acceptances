# Acceptances

团队共享的需求与验证报告工作台。成员在 Campaign 中保存需求依据，Agent 在业务目录执行验证，通过 CLI 保存报告与证据；用户在 Web 查看 Project → Campaign → Run，逐项人工评审、评论或作废。

Go 同时提供 API 和 React Web，MySQL 保存业务元数据、证据与离线文档的完整内容。本地开发由 Docker 提供 MySQL；平台需要注册登录，不依赖对象存储。全部检查项人工通过才整轮通过；只有最新完整范围 Run 全部人工通过，需求才整体通过。保存成功与 Agent 检查通过分别显示，局部复验不合并历史结果。

## 本机启动

首次使用时在仓库根执行。已有本地运行库升级先按下方说明核对目标并保存一致备份，再运行启动命令：

```sh
make docker-up
```

打开 <http://127.0.0.1:8765> 注册账号并登录，然后创建 Project 和需求。所有登录用户共享全部项目和操作能力，当前没有项目授权或数据隔离。全新数据首次启动自动初始化；已有数据按 [MySQL 存储与恢复](docs/mysql-storage.md) 核对目标并保存一致备份。服务仅绑定本机端口。应用以非 root 用户运行，代码层只读；业务和完整文件保存在 `acceptances_mysql-data`。普通重启或 `down` 保留数据，不要使用 `down -v`，除非明确要删除该项目全部记录。

```sh
curl --fail http://127.0.0.1:8765/health/ready
docker compose -f deploy/compose.yaml restart app
```

当前版本仅使用 MySQL，不提供 SQLite 启动、升级或导入。旧 MySQL 附件可通过 `make dev-stop` → `make mysql-files-migrate` → `make dev-up` 迁入数据库；完整数据库备份包含全部文件。保留当前凭据和必要备份，详见 [MySQL 存储与恢复](docs/mysql-storage.md)。

## 团队访问

VPS 使用 HTTPS 反向代理，设置 `ACCEPTANCES_PUBLIC_ORIGIN=https://你的域名` 并保留原始 Host，应用继续监听内网端口。Compose 可通过宿主环境变量 `ACCEPTANCES_PUBLIC_ORIGIN` 覆盖默认本机地址；不要将 MySQL 或内部应用端口直接公开。开放注册意味着访问入口的人都能注册并操作全部数据，初期应通过公司网络或网关限制入口。

旧库启动时自动追加用户相关表及可空的作者关联，不改写旧数据和冻结快照；升级前仍须保存一致备份。当前不提供密码找回、账号停用或公司 SSO。稳定用户 ID 与密码凭据已分开，后续可增加公司身份绑定。

## 从 Lark 导入需求

在已有 Campaign 中填写 Docx 或 Wiki 链接，由成员电脑上的连接器自动读取并回传，预览后确认导入。每个人使用自己的 Lark 授权，平台不保存 Lark token，也不主动连接成员电脑。

成员电脑先安装并以个人账号授权 Lark CLI；当前适配版本为 `1.0.98`，其他版本会明确拒绝启动，升级需先验证命令输出合同。按下方说明安装新版 Acceptances CLI，登录与网页相同的平台账号，然后在任意目录运行：

```sh
acceptances lark connect --url https://你的平台域名
```

导入期间保持此进程在线；不要求准备 Git 仓库或关联业务目录。连接器使用启动时固定的 Lark profile，只有本人的电脑会出现在选择列表；多台在线时选择此次使用的电脑。平台 CLI 登录与浏览器登录分别有效，会话过期后需在本机重新登录。

保存 Docx 正文、静态表格、可下载图片/画板、文档明确指定的嵌入 Sheet 单元格显示值，以及 HTML 附件原件；Wiki 必须指向 Docx。HTML 提供禁用脚本、表单、跳转与外部资源的静态预览。其他附件、Base、同步引用和外链不递归读取，缺失项必须明确确认。评论不作为需求正文导入。相同版本重复导入复用快照，重新导入不会覆盖旧版本。

嵌入 Sheet 需要应用已开通 `sheets:spreadsheet:read`，并在成员电脑执行 `lark-cli auth login --scope "sheets:spreadsheet:read"` 完成个人增量授权。应用权限处于审核中时仍无法读取，页面会保留明确缺口；审批及授权完成后重新导入即可补齐，不覆盖旧快照。

确认后的 PRD 对全部平台登录用户共享。Lark 原文后来撤权或删除，不自动清除平台快照。导入不代表需求已验收，也不生成 Run；PRD 分析和测试用例生成仍为 TODO。协议和完整边界见 [Lark PRD 导入](contracts/lark-prd.md)。

连接器应以已授权的同一操作系统用户运行。授权过期、权限不足或系统凭据访问失败时在本机处理，不换成共享账号，不把个人配置或凭据放进 Docker 镜像。VPS 仍部署平台服务和 MySQL，成员连接器单独安装。

## 关联业务项目

安装锁定的 Go、Node 和 pnpm 后，在本仓库执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
make build
make install-skill
```

安装器交付新版 CLI 和 `Acceptances-Cl` skill，已有安装时默认拒绝覆盖。替换旧版 CLI 和 skill，在本仓库执行 `make replace-skill`（等价于 `python3 scripts/v1/install-skill.py --replace`）。安装路径以命令输出为准。

浏览器注册账号后，先在本机执行 `acceptances login --url <服务地址> --username <用户名> --password-stdin`，通过标准输入传入密码（不要把密码写在参数或聊天中）。会话保存在用户配置目录的私有文件中，按服务地址分别保存，有效期七天；`whoami` 查看身份，`logout` 撤销当前 CLI 会话，均可指定 `--url`。Web 和 CLI 会话相互独立。

切换到业务目录，在加载新版 skill 的聊天中说：

> 使用 $Acceptances-Cl，将当前仓库关联到已有项目，并验证这次需求。需求依据是……，验证环境是……。

首次由 skill 选择已有 Project，后续复用宿主机关联。同仓库 worktree 共用关联，多个仓库可关联同一个 Project。日常调用复用本机已登录会话，无需反复传入账号凭据。验证任务不自动授权修改业务代码或作出人工接受决定。

操作流程见 [Agent 接入](docs/agents/v1-integration.md)。

## 冻结正式交付与业务说明

在实际验证报告发布前，项目侧 Agent 按[正式交付材料](skills/Acceptances-Cl/references/delivery.md)准备需求、地图、说明素材、真实构建及截图，以普通附件随报告整包保存。完成最新完整 Run 的全部人审后，点击“冻结正式交付”，确认版本、必验范围、说明内容与敏感信息检查；原始未通过项须有具体接受理由。

冻结快照保存当时结论及独立证据副本。绑定 Run 的改判、撤回、作废或删除让交付失效，原内容保留；再次接受不会自动恢复。新一轮自待审，新的明确冻结才替代旧版本。首页“交付归档”可查看效力历史，来源 Project/Campaign/Run 删除后仍可访问归档。

有效交付详情可生成业务说明，平台确定性渲染带内嵌图片的离线 HTML，无服务端 LLM。说明版本独立，可预览、下载及失败重试，不回写 Run 或快照。协议见[交付 API](contracts/delivery.md)。本轮源码实现不自动升级已有容器、CLI 或已安装 skill。

## 人工反馈后再次验证

在 Web 对每项通过、不通过、撤回或评论。人工不通过必填理由；Agent 原始结果为失败、阻塞或跳过时人工通过也必填理由。评论不改状态，发现问题需要明确改判；系统立即重算本轮状态。

在原业务聊天中发送：

> 使用 $Acceptances-Cl，读取 Campaign「需求名称」中 Run「ID」的逐项人工判断和评论。授权修复当前人工不通过项及本次指定的新问题，执行复验和必要回归。保留原始验证结果，实际完成后在同一 Campaign 保存新 Run，明确完整或局部范围，逐条关联来源反馈、处理说明及本次检查项，交给我再次评审。

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
| skills/Acceptances-Cl       | 宿主机 Agent 接入                 |

领域词汇见 [GLOSSARY](GLOSSARY.md)，架构决策见 [ADR-0001](docs/adr/0001-local-report-archive.md) 和[逐项评审决策](docs/adr/0002-per-check-human-review.md)。旧 V1 文档及 Git 历史保留为历史依据，不用于补回已删除能力。

## 许可与分发状态

本仓库按内容区分许可，没有覆盖全仓的统一 MIT 授权。入口为 [LICENSE](LICENSE)，逐文件／目录和混合内容范围见 [LICENSE-SCOPE.md](LICENSE-SCOPE.md)，来源与修改说明见 [NOTICE](NOTICE)。

LobeHub 模板／文档沿用及部分 validator 规则改写保留固定提交 `1c7a7116313bcc2d675937139554a244f7adf7a0` 的 [Community License](LICENSES/LobeHub-Community-1c7a711.txt)和 [Apache 2.0 正文](LICENSES/Apache-2.0.txt)，上游生产者与版权人保持原名；混合文件新增表达与旧 renderer 未确定边界列为待核实。新 V1 基础工程只有经证据确认有权授权的原创内容才采用 MIT，候选 MIT 版权署名已确认为 `Copyright (c) 2026 acceptances`，具体原创授权范围仍待确认，项目原创 MIT 生效范围为空。依赖和第三方材料继续遵守各自许可。

尚未公开发行；公开分发范围与条件未确认，A35 仍 blocked；本地精简版运行验收单独记录。这不是全仓 OSI 开源声明，也不代表上游已授予额外授权。与 LobeHub 无隶属或合作关系。
