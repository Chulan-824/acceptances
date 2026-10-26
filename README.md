# Acceptances

更新日期：2026-10-26（Asia/Shanghai）。本文按当前仓库实现整理，实际部署版本需单独核对。

团队共享的需求与验证报告工作台。成员在 Campaign 中保存需求依据，Agent 在业务目录执行验证，通过 CLI 保存报告与证据；用户在 Web 查看 Project → Campaign → Run，逐项人工评审、评论或作废。

推荐使用 Docker Compose 部署平台，Go 同时提供 API 和 React Web，MySQL 保存业务元数据、证据与离线文档的完整内容。成员电脑单独安装 `acceptances` CLI 和 `Acceptances-Cl` skill，业务验证及 Lark 连接器在成员电脑运行。平台需要注册登录，不依赖对象存储。

全部检查项人工通过才整轮通过；只有最新完整范围 Run 全部人工通过，需求才整体通过。保存成功、Agent 检查通过与人工接受分别表达，局部复验不合并历史结果。

## Docker 部署（推荐）

首次部署和成员接入请按 [服务器部署与成员安装手册](docs/deployment.md) 操作，包含依赖清单、HTTPS 配置、CLI / Skill 安装、飞书连接器、备份恢复和上线核对。

宿主机需要已启动的 Docker、支持 `include` 的 Docker Compose、`make` 和 Node.js `26.7.0`。当前部署入口使用宿主机 Node.js 生成数据库凭据和构建来源信息；Go、pnpm 和 Web 构建依赖在镜像中准备，无需在部署主机安装。

在仓库根目录执行。首次构建需要下载锁定的镜像和依赖；已有数据库升级前先按下方说明核对目标并备份：

```sh
make docker-up
docker compose -p acceptances -f deploy/compose.yaml ps
curl --fail --retry 15 --retry-delay 2 --retry-connrefused http://127.0.0.1:8765/health/ready
```

`make docker-up` 准备私有数据库凭据、从当前源码构建应用镜像，再启动 `app` 和 `mysql`；MySQL 健康后才启动应用。就绪检查成功后，打开 <http://127.0.0.1:8765> 注册并登录，创建 Project 和需求。

默认只发布 `127.0.0.1:8765`，MySQL 不发布宿主机端口。应用以非 root 用户运行，根文件系统只读。全新数据库首次启动自动初始化，已有 MySQL 数据库按版本执行结构迁移。

### 团队访问与 HTTPS

在同一宿主机配置 HTTPS 反向代理，将请求转发到 `http://127.0.0.1:8765`，保留浏览器请求的原始 Host。启动时将示例域名替换为实际入口：

```sh
ACCEPTANCES_PUBLIC_ORIGIN=https://acceptances.example.com make docker-up
```

`ACCEPTANCES_PUBLIC_ORIGIN` 必须是完整源地址，不带路径；远程入口必须使用 HTTPS。后续重建时继续传入相同配置，不要公开 MySQL 或内部应用端口。修改此配置后需重新运行部署入口，仅 `restart` 不会更新容器环境变量。

所有登录用户共享全部项目、需求、报告和操作能力，当前没有角色、项目授权或个人数据隔离。开放注册意味着能访问入口的人都能注册并操作全部业务数据，部署应通过公司网络或网关限制访问范围。当前不提供密码找回、账号停用或公司 SSO。

### 日常操作与更新

```sh
docker compose -p acceptances -f deploy/compose.yaml logs --tail=100 app
docker compose -p acceptances -f deploy/compose.yaml restart app
docker compose -p acceptances -f deploy/compose.yaml stop
```

更新到目标源码并完成备份后，运行 `make docker-rebuild` 重新构建和启动；团队入口继续传入原有 `ACCEPTANCES_PUBLIC_ORIGIN`。单纯重启不会加载新源码，更新平台也不会自动更新成员电脑上的 CLI、skill 或已运行的 Lark 连接器。

### 数据保留与升级

`acceptances_mysql-data` 保存业务元数据与完整文件，`.cache/mysql` 保存本机生成的数据库凭据。保留两者及一致性数据库备份；`acceptances_app-data` 用于旧 MySQL 附件兼容，也应在迁移完成前保留。普通重启、停止及 `down` 保留数据；`down -v` 会删除数据卷，不作为更新步骤。

升级前停止写入，核对真实数据库和卷，保存一致备份并确认恢复方案。旧库追加用户表和可空作者关联，不推断历史作者、不改写旧冻结快照。数据库 DDL 迁移失败会阻止启动，需要核对已执行结构后恢复，不能通过删除卷或凭据重试。

当前仅支持 MySQL，不提供 SQLite 启动、升级或导入。旧 MySQL 附件目录需单独迁入数据库；`make mysql-files-migrate` 面向开发库，不是部署库的通用迁移入口。备份、附件迁移与独立恢复验证见 [MySQL 存储与恢复](docs/mysql-storage.md)。

## 成员电脑：安装 CLI 与关联业务项目

平台通过 Docker 部署后，每位需要归档报告或运行 Lark 连接器的成员在自己的电脑安装 CLI。宿主机需要 Python 3、Go `1.26.8` 和 `make`；在本仓库执行即可，不需要先安装 Web 依赖或运行 `make build`：

```sh
make install-skill
```

安装器交付 `acceptances` CLI 和 `Acceptances-Cl` skill。默认 CLI 在 `~/.local/bin/acceptances`，skill 在 `~/.codex/skills/Acceptances-Cl`；设置了 `CODEX_HOME` 时使用其下的 `skills/Acceptances-Cl`。实际路径以安装回执为准。确保 `~/.local/bin` 已加入 PATH，并在 Agent 中重新加载技能列表。

已有安装时默认拒绝覆盖；更新现有 CLI 和 skill 使用 `make replace-skill`。其他成员机器上若仍安装旧名 `acceptances-v1`，替换安装后需核对并移除重复的旧技能目录。

先在 Web 注册平台账号，再在本机执行以下登录命令；密码由用户在本机通过标准输入提供，不写入参数或聊天：

```sh
acceptances login --url https://acceptances.example.com --username <用户名> --password-stdin
```

本机平台将地址替换为 `http://127.0.0.1:8765`。会话按服务地址保存在私有配置文件中，有效期七天；`whoami` 查看身份，`logout` 撤销当前 CLI 会话，均可指定 `--url`。Web 和 CLI 会话相互独立。

需要归档业务验证时，切换到业务目录，在加载新版 skill 的聊天中说：

> 使用 $Acceptances-Cl，将当前仓库关联到已有项目，并验证这次需求。需求依据是……，验证环境是……。

首次由 skill 选择已有 Project，后续复用宿主机关联。同仓库 worktree 共用关联，多个仓库可关联同一个 Project。验证指令不自动授权修改业务代码或作出人工接受决定。操作流程见 [Agent 接入](docs/agents/v1-integration.md)。

## 从 Lark 导入需求

在已有 Campaign 中填写 Docx 或 Wiki 链接，由成员电脑上的连接器自动读取并回传，预览后确认导入。每个人使用自己的 Lark 授权，平台不保存 Lark token，也不主动连接成员电脑。

成员电脑先安装并以个人账号授权 Lark CLI；当前适配版本为 `1.0.98`，其他版本会明确拒绝启动，升级需先验证命令输出合同。按上节说明安装新版 Acceptances CLI，登录与网页相同的平台账号，然后在任意目录运行：

```sh
acceptances lark connect --url https://你的平台域名
```

导入期间保持此进程在线；不要求准备 Git 仓库或关联业务目录。连接器使用启动时固定的 Lark profile，只有本人的电脑会出现在选择列表；多台在线时选择此次使用的电脑。平台 CLI 登录与浏览器登录分别有效，会话过期后需在本机重新登录。

保存 Docx 正文、静态表格、可下载图片/画板、文档明确指定的嵌入 Sheet 单元格显示值，以及 HTML 附件原件；Wiki 必须指向 Docx。HTML 提供禁用脚本、表单、跳转与外部资源的静态预览。其他附件、Base、同步引用和外链不递归读取，缺失项必须明确确认。评论不作为需求正文导入。相同版本重复导入复用快照，重新导入不会覆盖旧版本。

嵌入 Sheet 需要应用已开通 `sheets:spreadsheet:read`，并在成员电脑执行 `lark-cli auth login --scope "sheets:spreadsheet:read"` 完成个人增量授权。应用权限处于审核中时仍无法读取，页面会保留明确缺口；审批及授权完成后重新导入即可补齐，不覆盖旧快照。

确认后的 PRD 对全部平台登录用户共享。Lark 原文后来撤权或删除，不自动清除平台快照。导入不代表需求已验收，也不生成 Run；PRD 分析和测试用例生成仍为 TODO。协议和完整边界见 [Lark PRD 导入](contracts/lark-prd.md)。

连接器应以已授权的同一操作系统用户运行。授权过期、权限不足或系统凭据访问失败时在本机处理，不换成共享账号，不把个人配置或凭据放进 Docker 镜像。VPS 仍部署平台服务和 MySQL，成员连接器单独安装。

## 冻结正式交付与生成文档

在实际验证报告发布前，项目侧 Agent 按[正式交付材料](skills/Acceptances-Cl/references/delivery.md)准备需求、地图、说明素材、真实构建及截图，以普通附件随报告整包保存。完成最新完整 Run 的全部人审后，点击“冻结正式交付”，确认版本、必验范围、说明内容与敏感信息检查；原始未通过项须有具体接受理由。

冻结快照保存当时结论及独立证据副本。绑定 Run 的改判、撤回、作废或删除让交付失效，原内容保留；再次接受不会自动恢复。新一轮自待审，新的明确冻结才替代旧版本。首页“交付归档”可查看效力历史，来源 Project/Campaign/Run 删除后仍可访问归档。

有效交付详情可分别生成测试报告和业务指南，平台确定性渲染带内嵌图片的离线 HTML，无服务端 LLM。测试报告呈现冻结时的范围、检查结果、证据与人工评审；业务指南说明功能、页面操作与演示样例。两类文档分别保存版本，可预览、下载及失败重试，不回写 Run 或快照。协议见[交付 API](contracts/delivery.md)。

## 人工反馈后再次验证

在 Web 对每项通过、不通过、撤回或评论。人工不通过必填理由；Agent 原始结果为失败、阻塞或跳过时人工通过也必填理由。评论不改状态，发现问题需要明确改判；系统立即重算本轮状态。

在原业务聊天中发送：

> 使用 $Acceptances-Cl，读取 Campaign「需求名称」中 Run「ID」的逐项人工判断和评论。授权修复当前人工不通过项及本次指定的新问题，执行复验和必要回归。保留原始验证结果，实际完成后在同一 Campaign 保存新 Run，明确完整或局部范围，逐条关联来源反馈、处理说明及本次检查项，交给我再次评审。

Agent 使用 `acceptances feedback --campaign <标题或ID>` 读取反馈，`acceptances status --run <ID>` 核对指定 Run。人工通过的项不因 Agent 原来判断失败就自动进入修复范围。未处理或受阻如实说明，新 Run 各项重新待审；局部 Run 通过后需求整体仍待审。保存评论不会自动触发 Agent。

## 源码开发与验证

需要修改系统源码时，使用宿主机 Go/Vite 与 Docker MySQL。工具版本由 `toolchain.lock.json`、`go.mod` 和 `pnpm-lock.yaml` 固定，当前为 Go `1.26.8`、Node.js `26.7.0`、pnpm `12.4.2`。安装对应工具后执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
make dev                  # 自动启动 Docker MySQL，前台启动 Go/Vite，Ctrl-C 清理应用
# 或 make dev-up 后台启动；make dev-status 查询；make dev-stop 停止
make fmt
make lint typecheck build
make test
make test SUITE=mysql
make test SUITE=agent
make test SUITE=platform
```

开发 Web 为 <http://127.0.0.1:5173>，API 为 <http://127.0.0.1:8765>，数据库使用 `127.0.0.1:3307/acceptances_dev` 的 Docker MySQL，卷为 `acceptances-dev_mysql-data`。报告和完整附件保存在数据库；`.cache/dev-data` 只用于旧附件兼容与迁移。开发和 Docker 部署默认都占用 8765，不能同时使用该端口；开发可通过 `ACCEPTANCES_DEV_API_PORT`、`ACCEPTANCES_DEV_WEB_PORT` 选择其他端口。

开发环境首次关联可使用 `acceptances link --url http://127.0.0.1:5173 --project <项目名称>`，与 Web 共用 Vite 代理；也可分别配置 API 与人审入口：

```sh
acceptances link --url http://127.0.0.1:8765 --web-url http://127.0.0.1:5173 --project <项目名称>
```

后续命令复用关联中的 URL；改过端口的环境按实际地址填写。旧关联可重新 link 更新，`acceptances status --run <ID>` 只读返回人审链接。同源 Docker 部署不需要额外传入 `--web-url`。生产构建输出 `build/server`、`build/acceptances` 和 `apps/web/dist`。

`make test` 执行隔离 Go 测试、Web 单元及服务生命周期回归；数据库测试使用独立临时 MySQL 库。`make services-status` 查询受管开发/验证服务，`make services-stop` 停止它们；开发状态会对比运行服务与当前源码的构建身份，`ready` 本身不表示已加载最新源码。

真实浏览器回归使用用户指定的浏览器工具。`pnpm test:browser` 是保留的 Playwright 脚本入口，仅在用户明确要求执行该类脚本时运行，不作为一般浏览器回归的默认方式。分组与证据边界见 [Web 回归验证](apps/web/tests/README.md)。Docker 发布前可运行 `make release-check`，在隔离 Compose 项目验证构建、静态资源、健康状态和清理；该检查不部署日常服务，不能代替业务验收。命令边界见 [工具链](docs/toolchain.md)，T1–T9 验证步骤见 [实现交接](docs/v1-implementation-handoff.md)。

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

当前已确认的原创文件按 [标准 MIT](LICENSES/MIT.txt) 授权，署名 `Copyright (c) 2026 acceptances`；具体文件、基线与内容摘要以 [MIT 清单](docs/licensing/mit-scope.json) 为准，不覆盖全部目录、未来新增内容或历史版本。

LobeHub 沿用及改写内容保留固定提交 `1c7a7116313bcc2d675937139554a244f7adf7a0` 的 [Community License](LICENSES/LobeHub-Community-1c7a711.txt)和 [Apache 2.0 正文](LICENSES/Apache-2.0.txt)。混合内容、历史 renderer、依赖及第三方材料分别按许可范围和各自条款处理。

尚未公开发行；公开分发范围与条件未确认，A35 仍 blocked；本地精简版运行验收单独记录。这不是全仓 OSI 开源声明，也不代表上游已授予额外授权。与 LobeHub 无隶属或合作关系。
