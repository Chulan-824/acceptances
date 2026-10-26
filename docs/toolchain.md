# 工具链与验证命令

运行时及镜像 digest 保留在 `toolchain.lock.json`，Go 依赖以 `go.mod/go.sum` 为准，JavaScript 依赖以 `pnpm-lock.yaml` 为准。当前锁定 Go 1.26.8、Node 26.7.0、pnpm 12.4.2、TypeScript 5.9.3。日常开发与应用容器使用锁定镜像的 Docker MySQL，连接凭据由本机脚本生成。运行时及数据库集成测试统一使用 MySQL。无需 PostgreSQL、sqlc 或云 SDK。

| 命令                       | 行为                                                  |
| -------------------------- | ----------------------------------------------------- |
| `make dev`                 | 健康启动 Docker MySQL 后启动 Go/Vite，Ctrl-C 停止应用 |
| `make dev-up`              | 后台启动开发服务，就绪后返回；失败自动回收            |
| `make dev-status`          | 查询开发服务状态、PID、地址与日志                     |
| `make dev-stop`            | 停止本仓库受管开发服务，保留开发数据                  |
| `make services-status`     | 查询本仓库开发、平台烟测和浏览器验证服务              |
| `make services-stop`       | 停止上述受管服务；会中断正在执行的验证                |
| `make test SUITE=services` | 进程生命周期回归与真实开发服务启动/退出烟测           |
| `make fmt`                 | 格式化当前应用、配置、脚本和接入文档                  |
| `make lint`                | Prettier、ESLint、go vet 和 gofmt 检查                |
| `make typecheck`           | Web 与客户端类型检查                                  |
| `make build`               | 构建 Web、服务和当前平台 CLI                          |
| `make test`                | Go、Web 单元及服务生命周期测试；数据库使用隔离 MySQL  |
| `make test SUITE=web`      | 已有 Web 单元测试                                     |
| `make test SUITE=browser`  | 构建当前源码，再执行隔离 Go 服务上的真实浏览器回归    |
| `make test SUITE=mysql`    | 在临时 MySQL 数据库验证 HTTP、约束、并发和文件保留    |
| `make mysql-files-migrate` | 停写后完整备份 MySQL，迁移所有附件并回读校验后切换    |
| `make mysql-status`        | 查看本地开发 MySQL 容器状态                           |
| `make mysql-stop`          | 停止开发 MySQL，保留持久卷                            |
| `make test SUITE=http`     | HTTP 集成测试                                         |
| `make test SUITE=cli`      | CLI 外部行为测试                                      |
| `make test SUITE=agent`    | 接入辅助工具与 CLI 测试                               |
| `make test SUITE=platform` | 已构建二进制、临时数据初始化、Web 静态资源及正常停机  |
| `make test SUITE=e2e`      | 调用外部真实浏览器驱动并校验回执                      |
| `make docker-up`           | 构建并启动应用与 MySQL                                |
| `make docker-build`        | 只构建发布镜像，不启动日常服务                        |
| `make release-check`       | 源码副本构建及隔离 Docker 发布烟测                    |
| `make install-skill`       | 安装宿主机 CLI 和 skill                               |

旧 DTO、OpenAPI 和 sqlc 生成流程已移除。未知测试分组返回非零，不将未运行标记为通过。

`make test SUITE=http` 同时运行 `internal/api`、`internal/handler`、`internal/service`、`internal/dao` 和 `internal/httpserver`，覆盖 Campaign 分层测试及现有 HTTP 集成测试。`all`、`http`、`mysql`、`platform`、`services` 和 `browser` 分组会准备 Docker MySQL 并向测试进程注入连接文件；每个测试创建专用数据库，不使用日常库作为测试归档。MySQL 分组继续通过临时数据库验证真实存储行为。

`pnpm check` 执行 lint、类型检查、Go/Web 测试和构建，不启动 Playwright 浏览器。日常浏览器回归使用用户指定的 Codex `@Chrome`、Claude in Chrome 或 `ego-browser`，按 [Agent 浏览器约定](../AGENTS.md#browser-regression) 执行；验证失败或工具不可用时不自动切换到 Playwright。

## CI 与提交检查

GitHub Actions 的 `Checks / check` 在 PR、推送到 `main` 和手动触发时运行。运行时版本读取 `toolchain.lock.json`，安装锁定依赖后执行现有 `pnpm check`；MySQL 仍由测试入口准备隔离测试库。工作流使用 GitHub 官方的 [checkout](https://github.com/actions/checkout)、[setup-node](https://github.com/actions/setup-node) 和 [setup-go](https://github.com/actions/setup-go)，Jev 依赖通过 [setup-uv](https://github.com/astral-sh/setup-uv) 准备。

之后执行 `make check-extra BASE=<基线提交>`，按基线与 HEAD 的变更路径补检：

| 变更范围                                                                                     | 补跑入口                                     |
| -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `skills/Acceptances-Cl/`、`internal/cli/`、`cmd/acceptances/`、skill 安装器及 Jev probe 测试 | `make test SUITE=agent`                      |
| `tools/jev-browser/`、Jev Compose 配置、Jev 接入文档                                         | 上述 agent 检查及 `make jev-setup jev-check` |
| CI、Git hook、检查脚本、Makefile、工具链或依赖锁文件                                         | 两组均执行                                   |

重命名按旧、新两个路径判断，删除也触发补检。手动 CI、新分支首推或比较基线不可用时补跑两组。`make check-extra` 不传 BASE 时检查当前已跟踪改动和未忽略的新文件，适合提交前本地补跑；无相关改动则直接结束。Jev 补检只做 Ruff 和离线单测，不需要 Key、Chrome 或模型调用。

Jev 的安全、严格路径和统计逻辑单测也属于上述离线补检。需要真实 Chrome 的可复跑安全与性能对照时，显式使用 `make jev-regression`，默认仅运行临时合成页和 A/A 自检，不调用模型；自选基线、任务、官方模型及证据口径见 [统一 Jev 回归](agents/jev-browser.md#统一安全路径与性能回归)。该入口不被普通 CI 或提交检查自动执行。

每个克隆执行一次 `make hooks-install` 启用仓库内的 `.githooks/pre-commit`；已有其他 `core.hooksPath` 时拒绝覆盖，需手动整合。也可随时执行 `make check-staged`。提交检查读取暂存版本，运行 `git diff --cached --check`、Prettier、JS/TS 的 ESLint 和 `cmd/`、`internal/`、`db/` 下 Go 文件的 gofmt；只检查支持的文件类型，尊重 `.prettierignore` 和 ESLint 忽略规则，不改写文件或暂存区。它不运行构建、数据库测试或 Python/Jev 检查，后者由上述 CI 目录补检覆盖。需要先安装 Node/pnpm 依赖；暂存 Go 文件时还需 gofmt。

`make test` 包含检查脚本的隔离 Git 仓库回归，验证部分暂存、含空格路径、格式及 ESLint 失败拦截、Go 格式、删除和目录选择，不操作当前仓库的暂存区或提交历史。CI 成功仅代表这些自动检查通过；合并保护中的必需状态检查需在仓库设置中另行启用。

上表 `make test SUITE=browser` 及其别名 `pnpm test:browser` 是保留的 Playwright 脚本入口，仅在用户明确要求执行此类脚本回归时运行。届时可用 `BROWSER_GROUPS=review,preview pnpm test:browser` 选择分组。不要因一般的浏览器回归请求或 Jev 接入自动启动这些入口。依赖、覆盖范围、隔离与产物说明见 [Web 回归验证](../apps/web/tests/README.md)。

用户选择真实 Chrome + Jev 时，通过 `make jev-config` 创建根目录 `.env`，启动器将 Jev 配置注入执行进程。宿主机使用 `make jev-setup`、`make jev-doctor`、`make jev-inspect URL=...`、`make jev-run TASK=...`；可选 Docker 执行器使用对应的 `jev-docker-build`、`jev-docker-doctor`、`jev-docker-inspect`、`jev-docker-run`。两者通过 CDP 连接宿主机真实 Chrome，使用 `TYPESAFE_API_KEY` 调用官方 Jev API。`make jev-check` 只运行离线检查。配置、任务合同和证据边界见 [Jev 接入](agents/jev-browser.md)。这些可选命令不纳入 `pnpm check`，不启动 Playwright，也不会启动或重建日常应用、数据库。

构建前执行 `pnpm install --frozen-lockfile --ignore-scripts`。Make 使用精确 `GOTOOLCHAIN`，Go 缓存位于 `.cache`。首次构建可能下载工具链和依赖。

Go 测试每个包的超时为 600 秒，包含隔离库结构初始化及真实账号认证；单个失败仍返回非零。

运行验证按静态检查、进程内 HTTP 集成、原生进程、Docker、真实浏览器分别报告。归档源码 commit、dirty 状态、构建产物摘要、命令和实际结果；仅在本机执行不代表其他架构已验证。真实产品验收按 [T1–T9 及逐项评审交接](v1-implementation-handoff.md) 记录，日常运行库迁移结果单独报告。

`make test SUITE=agent` 在临时安装目标验证 CLI 与 skill，并运行隔离 CLI 测试及可选 Jev 的离线选择测试，不升级日常安装。Jev 选择测试使用受控 doctor，验证已配置、缺配置、执行器失效、超时及诊断脱敏，不连接 Chrome 或官方模型；不能据此声称真实回归通过。`make test SUITE=e2e` 只核对外部驱动回执与证据文件，逐项评审、范围及反馈关联必须由真实浏览器操作和 API 断言覆盖。源码更新后的日常安装使用 `make replace-skill`，替换结果以安装器回执为准。

Lark PRD 导入的 `internal/prd` 用例校验公开的 URL、文档规范化和上传包合同；`internal/cli` 使用受控外部 `lark-cli` 验证个人 profile、固定修订、资源与错误处理；HTTP/MySQL 分组包含真实平台登录、连接器 CLI 子进程、任务领取回传和共享确认的完整链路。Web 分组验证用户可观察的导入交互。它们不访问成员的真实 PRD，也不能替代真实 Lark 授权、不同电脑及 VPS 网络验收。接口与成员操作见 [Lark 导入合同](../contracts/lark-prd.md) 和 [README](../README.md#从-lark-导入需求)。

## Docker 发布检查

`make release-check` 是独立发布检查入口，不加入 `pnpm check` 或轻量提交检查。它先运行发布检查单测，再从当前 Git 工作区复制已跟踪文件和未忽略的新文件，排除 `.env*`、Git 元数据、本机依赖、缓存和构建产物。未提交改动会进入副本，删除的文件不进入；符号链接直接拒绝。源码文件列表、整体摘要、HEAD 和 dirty 状态写入回执，因此本地 dirty 验证不能声称验证了某个干净提交。

构建仍调用现有 `make docker-build`，上下文切换到源码副本，使用 Dockerfile 锁定的运行时和依赖，不依赖宿主机的 Web dist 或 Go 二进制。检查从副本中的实际 Compose 配置生成临时配置，保留镜像、启动参数、健康检查及运行限制，替换为随机项目名、临时凭据、专用网络和数据卷，只发布随机的 `127.0.0.1` 应用端口，不发布 MySQL 端口。不调用日常 `make docker-up` 或凭据准备器。

容器就绪后检查 live/ready、首页根节点、生产 JS/CSS 入口、可解析的 ESM/CSS 本地资源引用、四个 Geist 字体与字体许可文件、未认证 API 401 和镜像内 CLI 版本。HTTP 状态、资源类型和字体签名均需符合预期，避免把 SPA 的 HTML 回退当作静态资源成功；原生 `make test SUITE=platform` 复用相同 HTTP 检查。构建缺少 COPY/embed 输入、启动失败、资源缺失均返回非零。

成功与失败都会尝试回收本轮项目的容器、卷、网络和镜像，并核对资源未残留；清理失败也算检查失败，保留私有临时目录供恢复清理，不归档其中的凭据。日志、无凭据的生成配置、源码副本和 `result.json` 位于 `artifacts/release-check/<随机项目名>/`。Ctrl-C/SIGTERM 会进入清理，外部命令受超时限制；SIGKILL、Docker 守护进程不可用或宿主机中断仍可能需要根据回执中的项目名手动清理。

GitHub Actions 的 `Release checks / docker` 独立于普通 Checks，在 PR 或 `main` 推送涉及 Docker/Compose、应用源码、依赖锁、发布脚本、许可材料时运行，也支持手动触发。CI 从 checkout 的源码执行同一 `make release-check`，无论成败均尝试通过官方 [upload-artifact](https://github.com/actions/upload-artifact) 归档证据，保留 7 天。该检查不推送镜像、不部署应用；本机运行不代表 GitHub 托管 runner、其他架构或完整业务验收已通过。

## 本机服务生命周期

`make build`、`make docker-build` 和开发 API 的 `go run` 通过现有 `buildinfo` 注入构建时的 commit、dirty 标记及源码 SHA-256。源码摘要覆盖 `cmd/`、`internal/`、`db/` 和 Go 嵌入的 Web 包、主题及字体，排除 Go 测试和 `.env*`，不把 Web TS/TSX 的改动当成 API 已加载的内容。dirty 使用整个 Git 工作区状态，因此它可能因文档等非 API 改动变化；它是构建来源信息，不单独证明运行内容。普通 `go build` 可从 Go 的 VCS 元数据补充 commit/dirty，但未注入的源码摘要仍为 `unknown`。

`GET /api/v1/capabilities` 保留原有 version/commit 字段，并通过 `build` 返回上述身份。`make dev-status` / `make services-status` 在原有状态中增加 `sourceAtStart`、`currentSource`，各 API/server 进程的 `identity` 来自运行服务自身的 capabilities，`sourceComparison` 为 `matches`、`differs` 或 `unknown`。比较 commit、dirty 及源码摘要，不能仅凭相同 commit 或 ready=200 判断运行版本一致。同一 commit 下再次修改未提交源码，也会因摘要变化而显示 `differs`。

旧所有者、旧二进制、缺少 Git 信息或无法读取身份时显示 `unknown`；已有服务不会因代码更新被自动重启。原生隔离服务读取所启动二进制的实际身份，不给旧二进制套用当前工作区的版本。Vite 进程显示 `reload: vite-hmr`，其启动来源不能证明当前浏览器已加载的模块版本，配置和依赖变化也可能需要重启；是否重启继续由当前任务授权决定。源码在编译过程中被修改时，应在稳定源码后重新构建和验证，启动指纹不提供原子快照保证。

`make test SUITE=services` 额外在临时源码克隆、临时 MySQL 库和随机端口运行真实 API，验证同 commit 的未提交修改、临时 main 前进后旧 API 仍 ready、状态保持旧身份并显示差异，以及重建重启后恢复匹配。该测试只在临时克隆创建 fixture 提交，不改当前仓库历史，也不重启日常 API。已有日常开发会话时，原有完整 Go/Vite 开发烟测继续明确跳过；隔离版本测试仍可执行。

开发、平台烟测和浏览器回归共用 `scripts/v1/services.mjs`。Agent 启动本机服务时使用上述入口，避免独立的 `nohup` 或 `&` 启动器绕过状态记录与退出清理。`make dev` 保持前台，Ctrl-C 或 SIGTERM 会回收 API、Vite 及其进程组；`make dev-up` 后台启动，等待 API 和 Web 代理就绪才返回。任一开发子进程退出或部分启动失败会停止整组，先 TERM，6 秒后仍未退出则 KILL。平台和浏览器验证继续使用独立临时数据、随机端口，完成后停止服务并核对端口已释放。

开发默认 API 8765、Web 5173。启动前检查两个端口，Vite 使用 strictPort，不会悄悄换端口。需要同时保留其他本机服务时，可显式指定 `ACCEPTANCES_DEV_API_PORT`、`ACCEPTANCES_DEV_WEB_PORT`；两个值须是不同的 1–65535 整数，Web 代理同步指向指定 API。旧归档目录由 `ACCEPTANCES_DATA_DIR` 指定，默认 `.cache/dev-data`。开发入口使用 Docker MySQL 的 `acceptances_dev` 数据库；停止 Go/Vite 不停止 MySQL。迁移、凭据和备份规则见 [MySQL 存储](mysql-storage.md)。

状态记录和开发日志保存在 `.cache/services/`，每次启动覆盖 `api.log`、`web.log`，后台启动另有 `dev.log`。状态为 `starting`、`ready`、`stopping` 或 `stale`，没有记录显示 `[]`。`make dev-stop` 只停止开发；`make services-stop` 也会中断当前平台/浏览器验证。停止命令通过本机控制 socket 联系持有子进程句柄的启动器，不使用磁盘 PID 杀进程。过期记录由对应 stop 命令清理；未知占用方需先核对端口、PID、cwd 和启动来源。

这些服务控制命令不停止 Docker MySQL、旧启动器或其他仓库的服务。SIGKILL、系统崩溃无法执行退出钩子，可能留下 `stale` 记录和进程；此时 stop 只清除失效记录，不冒险按旧 PID 结束进程，需核对实际监听者后处理。不要直接删除正在使用的状态目录。

`make test` 包含随机端口上的生命周期回归，其中包装进程退出回归使用独立根目录、状态记录和数据目录，覆盖 API/Web 包装进程退出后后代仍持有输出管道、启动中退出和超时强制清理，已有开发会话运行时也可执行。`make test SUITE=services` 还使用临时数据启动真实 Go/Vite，验证后台就绪、重复启动保护、代理、中断、端口冲突和部分失败清理。若已有受管开发会话，该开发烟测会明确跳过，避免中断工作；生命周期回归仍执行。

## Web 样式

`apps/web` 使用 Tailwind CSS 4，通过 `@tailwindcss/vite` 接入 Vite，精确版本以该应用的 `package.json` 和根锁文件为准。入口为 `apps/web/src/style.css`，加载 Tailwind 默认主题与工具类，Vite 构建时扫描源码中的类名并生成 CSS；无需 CDN、PostCSS 配置或旧版 `tailwind.config.js`。

现有样式位于 `components` 层，Tailwind 的 `utilities` 层可覆盖它们。为保留当前标题、表单和其他元素的浏览器默认样式，暂不加载 Preflight；页面迁移时再统一评估全局重置。新增样式可直接使用静态工具类，例如 `className="flex gap-4"`，不要拼接 `bg-${color}-500` 一类无法完整扫描的类名。

修改 Web 样式或组件前，读取[现行设计规范](../DESIGN.md)。主题接入、字体来源及历史设计稿的适用范围见[设计来源与主题接入](design-reference.md)。
