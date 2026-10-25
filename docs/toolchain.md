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
| `make install-skill`       | 安装宿主机 CLI 和 skill                               |

旧 DTO、OpenAPI 和 sqlc 生成流程已移除。未知测试分组返回非零，不将未运行标记为通过。

`make test SUITE=http` 同时运行 `internal/api`、`internal/handler`、`internal/service`、`internal/dao` 和 `internal/httpserver`，覆盖 Campaign 分层测试及现有 HTTP 集成测试。`all`、`http`、`mysql`、`platform`、`services` 和 `browser` 分组会准备 Docker MySQL 并向测试进程注入连接文件；每个测试创建专用数据库，不使用日常库作为测试归档。MySQL 分组继续通过临时数据库验证真实存储行为。

`pnpm check` 执行 lint、类型检查、Go/Web 测试和构建，不启动 Playwright 浏览器。日常浏览器回归使用用户指定的 Codex `@Chrome`、Claude in Chrome 或 `ego-browser`，按 [Agent 浏览器约定](../AGENTS.md#browser-regression) 执行；验证失败或工具不可用时不自动切换到 Playwright。

## CI 与提交检查

GitHub Actions 的 `Checks / check` 在 PR、推送到 `main` 和手动触发时运行。运行时版本读取 `toolchain.lock.json`，安装锁定依赖后执行现有 `pnpm check`；MySQL 仍由测试入口准备隔离测试库。工作流使用 GitHub 官方的 [checkout](https://github.com/actions/checkout)、[setup-node](https://github.com/actions/setup-node) 和 [setup-go](https://github.com/actions/setup-go)，Jev 依赖通过 [setup-uv](https://github.com/astral-sh/setup-uv) 准备。

之后执行 `make check-extra BASE=<基线提交>`，按基线与 HEAD 的变更路径补检：

| 变更范围                                                                                     | 补跑入口                                     |
| -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `skills/acceptances-v1/`、`internal/cli/`、`cmd/acceptances/`、skill 安装器及 Jev probe 测试 | `make test SUITE=agent`                      |
| `tools/jev-browser/`、Jev Compose 配置、Jev 接入文档                                         | 上述 agent 检查及 `make jev-setup jev-check` |
| CI、Git hook、检查脚本、Makefile、工具链或依赖锁文件                                         | 两组均执行                                   |

重命名按旧、新两个路径判断，删除也触发补检。手动 CI、新分支首推或比较基线不可用时补跑两组。`make check-extra` 不传 BASE 时检查当前已跟踪改动和未忽略的新文件，适合提交前本地补跑；无相关改动则直接结束。Jev 补检只做 Ruff 和离线单测，不需要 Key、Chrome 或模型调用。

每个克隆执行一次 `make hooks-install` 启用仓库内的 `.githooks/pre-commit`；已有其他 `core.hooksPath` 时拒绝覆盖，需手动整合。也可随时执行 `make check-staged`。提交检查读取暂存版本，运行 `git diff --cached --check`、Prettier、JS/TS 的 ESLint 和 `cmd/`、`internal/`、`db/` 下 Go 文件的 gofmt；只检查支持的文件类型，尊重 `.prettierignore` 和 ESLint 忽略规则，不改写文件或暂存区。它不运行构建、数据库测试或 Python/Jev 检查，后者由上述 CI 目录补检覆盖。需要先安装 Node/pnpm 依赖；暂存 Go 文件时还需 gofmt。

`make test` 包含检查脚本的隔离 Git 仓库回归，验证部分暂存、含空格路径、格式及 ESLint 失败拦截、Go 格式、删除和目录选择，不操作当前仓库的暂存区或提交历史。CI 成功仅代表这些自动检查通过；合并保护中的必需状态检查需在仓库设置中另行启用。

上表 `make test SUITE=browser` 及其别名 `pnpm test:browser` 是保留的 Playwright 脚本入口，仅在用户明确要求执行此类脚本回归时运行。届时可用 `BROWSER_GROUPS=review,preview pnpm test:browser` 选择分组。不要因一般的浏览器回归请求或 Jev 接入自动启动这些入口。依赖、覆盖范围、隔离与产物说明见 [Web 回归验证](../apps/web/tests/README.md)。

用户选择真实 Chrome + Jev 时，通过 `make jev-config` 创建根目录 `.env`，启动器将 Jev 配置注入执行进程。宿主机使用 `make jev-setup`、`make jev-doctor`、`make jev-inspect URL=...`、`make jev-run TASK=...`；可选 Docker 执行器使用对应的 `jev-docker-build`、`jev-docker-doctor`、`jev-docker-inspect`、`jev-docker-run`。两者通过 CDP 连接宿主机真实 Chrome，使用 `TYPESAFE_API_KEY` 调用官方 Jev API。`make jev-check` 只运行离线检查。配置、任务合同和证据边界见 [Jev 接入](agents/jev-browser.md)。这些可选命令不纳入 `pnpm check`，不启动 Playwright，也不会启动或重建日常应用、数据库。

构建前执行 `pnpm install --frozen-lockfile --ignore-scripts`。Make 使用精确 `GOTOOLCHAIN`，Go 缓存位于 `.cache`。首次构建可能下载工具链和依赖。

运行验证按静态检查、进程内 HTTP 集成、原生进程、Docker、真实浏览器分别报告。归档源码 commit、dirty 状态、构建产物摘要、命令和实际结果；仅在本机执行不代表其他架构已验证。真实产品验收按 [T1–T9 及逐项评审交接](v1-implementation-handoff.md) 记录，日常运行库迁移结果单独报告。

`make test SUITE=agent` 在临时安装目标验证 CLI 与 skill，并运行隔离 CLI 测试及可选 Jev 的离线选择测试，不升级日常安装。Jev 选择测试使用受控 doctor，验证已配置、缺配置、执行器失效、超时及诊断脱敏，不连接 Chrome 或官方模型；不能据此声称真实回归通过。`make test SUITE=e2e` 只核对外部驱动回执与证据文件，逐项评审、范围及反馈关联必须由真实浏览器操作和 API 断言覆盖。源码更新后的日常安装使用 `make replace-skill`，替换结果以安装器回执为准。

## 本机服务生命周期

开发、平台烟测和浏览器回归共用 `scripts/v1/services.mjs`。Agent 启动本机服务时使用上述入口，避免独立的 `nohup` 或 `&` 启动器绕过状态记录与退出清理。`make dev` 保持前台，Ctrl-C 或 SIGTERM 会回收 API、Vite 及其进程组；`make dev-up` 后台启动，等待 API 和 Web 代理就绪才返回。任一开发子进程退出或部分启动失败会停止整组，先 TERM，6 秒后仍未退出则 KILL。平台和浏览器验证继续使用独立临时数据、随机端口，完成后停止服务并核对端口已释放。

开发默认 API 8765、Web 5173。启动前检查两个端口，Vite 使用 strictPort，不会悄悄换端口。需要同时保留其他本机服务时，可显式指定 `ACCEPTANCES_DEV_API_PORT`、`ACCEPTANCES_DEV_WEB_PORT`；两个值须是不同的 1–65535 整数，Web 代理同步指向指定 API。旧归档目录由 `ACCEPTANCES_DATA_DIR` 指定，默认 `.cache/dev-data`。开发入口使用 Docker MySQL 的 `acceptances_dev` 数据库；停止 Go/Vite 不停止 MySQL。迁移、凭据和备份规则见 [MySQL 存储](mysql-storage.md)。

状态记录和开发日志保存在 `.cache/services/`，每次启动覆盖 `api.log`、`web.log`，后台启动另有 `dev.log`。状态为 `starting`、`ready`、`stopping` 或 `stale`，没有记录显示 `[]`。`make dev-stop` 只停止开发；`make services-stop` 也会中断当前平台/浏览器验证。停止命令通过本机控制 socket 联系持有子进程句柄的启动器，不使用磁盘 PID 杀进程。过期记录由对应 stop 命令清理；未知占用方需先核对端口、PID、cwd 和启动来源。

这些服务控制命令不停止 Docker MySQL、旧启动器或其他仓库的服务。SIGKILL、系统崩溃无法执行退出钩子，可能留下 `stale` 记录和进程；此时 stop 只清除失效记录，不冒险按旧 PID 结束进程，需核对实际监听者后处理。不要直接删除正在使用的状态目录。

`make test` 包含随机端口上的生命周期回归，其中包装进程退出回归使用独立根目录、状态记录和数据目录，覆盖 API/Web 包装进程退出后后代仍持有输出管道、启动中退出和超时强制清理，已有开发会话运行时也可执行。`make test SUITE=services` 还使用临时数据启动真实 Go/Vite，验证后台就绪、重复启动保护、代理、中断、端口冲突和部分失败清理。若已有受管开发会话，该开发烟测会明确跳过，避免中断工作；生命周期回归仍执行。

## Web 样式

`apps/web` 使用 Tailwind CSS 4，通过 `@tailwindcss/vite` 接入 Vite，精确版本以该应用的 `package.json` 和根锁文件为准。入口为 `apps/web/src/style.css`，加载 Tailwind 默认主题与工具类，Vite 构建时扫描源码中的类名并生成 CSS；无需 CDN、PostCSS 配置或旧版 `tailwind.config.js`。

现有样式位于 `components` 层，Tailwind 的 `utilities` 层可覆盖它们。为保留当前标题、表单和其他元素的浏览器默认样式，暂不加载 Preflight；页面迁移时再统一评估全局重置。新增样式可直接使用静态工具类，例如 `className="flex gap-4"`，不要拼接 `bg-${color}-500` 一类无法完整扫描的类名。

修改 Web 样式或组件前，读取[现行设计规范](../DESIGN.md)。主题接入、字体来源及历史设计稿的适用范围见[设计来源与主题接入](design-reference.md)。
