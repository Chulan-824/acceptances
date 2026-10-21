# 工具链与验证命令

运行时及镜像 digest 保留在 `toolchain.lock.json`，Go 依赖以 `go.mod/go.sum` 为准，JavaScript 依赖以 `pnpm-lock.yaml` 为准。当前锁定 Go 1.26.8、Node 26.7.0、pnpm 12.4.2、TypeScript 5.9.3。SQLite 随 Go 应用交付，不需要 PostgreSQL、sqlc、数据库密码或云 SDK。

| 命令                       | 行为                                                           |
| -------------------------- | -------------------------------------------------------------- |
| `make dev`                 | 启动 Go 与 Vite，自动初始化 `.cache/dev-data`，Ctrl-C 停止两者 |
| `make dev-up`              | 后台启动开发服务，就绪后返回；失败自动回收                     |
| `make dev-status`          | 查询开发服务状态、PID、地址与日志                              |
| `make dev-stop`            | 停止本仓库受管开发服务，保留开发数据                           |
| `make services-status`     | 查询本仓库开发、平台烟测和浏览器验证服务                       |
| `make services-stop`       | 停止上述受管服务；会中断正在执行的验证                         |
| `make test SUITE=services` | 进程生命周期回归与真实开发服务启动/退出烟测                    |
| `make fmt`                 | 格式化当前应用、配置、脚本和接入文档                           |
| `make lint`                | Prettier、ESLint、go vet 和 gofmt 检查                         |
| `make typecheck`           | Web 与客户端类型检查                                           |
| `make build`               | 构建 Web、服务和当前平台 CLI                                   |
| `make test`                | Go、Web 单元及服务生命周期测试，以隔离数据验证                 |
| `make test SUITE=web`      | 已有 Web 单元测试                                              |
| `make test SUITE=browser`  | 构建当前源码，再执行隔离 Go 服务上的真实浏览器回归             |
| `make test SUITE=http`     | HTTP 集成测试                                                  |
| `make test SUITE=cli`      | CLI 外部行为测试                                               |
| `make test SUITE=agent`    | 接入辅助工具与 CLI 测试                                        |
| `make test SUITE=platform` | 已构建二进制、临时数据初始化、Web 静态资源及正常停机           |
| `make test SUITE=e2e`      | 调用外部真实浏览器驱动并校验回执                               |
| `make docker-up`           | 构建并启动单容器，不删除已有卷                                 |
| `make install-skill`       | 安装宿主机 CLI 和 skill                                        |

旧 DTO、OpenAPI 和 sqlc 生成流程已移除。未知测试分组返回非零，不将未运行标记为通过。

`pnpm check` 执行 lint、类型检查、Go/Web 测试和构建。`pnpm test:browser` 单独运行已有浏览器场景，可用 `BROWSER_GROUPS=review,preview pnpm test:browser` 选择分组。依赖、覆盖范围、隔离与产物说明见 [Web 回归验证](../apps/web/tests/README.md)。

构建前执行 `pnpm install --frozen-lockfile --ignore-scripts`。Make 使用精确 `GOTOOLCHAIN`，Go 缓存位于 `.cache`。首次构建可能下载工具链和依赖。

运行验证按静态检查、进程内 HTTP 集成、原生进程、Docker、真实浏览器分别报告。归档源码 commit、dirty 状态、构建产物摘要、命令和实际结果；仅在本机执行不代表其他架构已验证。真实产品验收按 [T1–T9 及逐项评审交接](v1-implementation-handoff.md) 记录，日常运行库迁移结果单独报告。

`make test SUITE=agent` 在临时安装目标验证 CLI 与 skill，并运行隔离 CLI 测试，不升级日常安装。`make test SUITE=e2e` 只核对外部驱动回执与证据文件，逐项评审、范围及反馈关联必须由真实浏览器操作和 API 断言覆盖。源码更新后的日常安装使用 `make replace-skill`，替换结果以安装器回执为准。

## 本机服务生命周期

开发、平台烟测和浏览器回归共用 `scripts/v1/services.mjs`。Agent 启动本机服务时使用上述入口，避免独立的 `nohup` 或 `&` 启动器绕过状态记录与退出清理。`make dev` 保持前台，Ctrl-C 或 SIGTERM 会回收 API、Vite 及其进程组；`make dev-up` 后台启动，等待 API 和 Web 代理就绪才返回。任一开发子进程退出或部分启动失败会停止整组，先 TERM，6 秒后仍未退出则 KILL。平台和浏览器验证继续使用独立临时数据、随机端口，完成后停止服务并核对端口已释放。

开发默认 API 8765、Web 5173。启动前检查两个端口，Vite 使用 strictPort，不会悄悄换端口。需要同时保留其他本机服务时，可显式指定 `ACCEPTANCES_DEV_API_PORT`、`ACCEPTANCES_DEV_WEB_PORT`；两个值须是不同的 1–65535 整数，Web 代理同步指向指定 API。开发数据仍由 `ACCEPTANCES_DATA_DIR` 指定，默认 `.cache/dev-data`。

状态记录和开发日志保存在 `.cache/services/`，每次启动覆盖 `api.log`、`web.log`，后台启动另有 `dev.log`。状态为 `starting`、`ready`、`stopping` 或 `stale`，没有记录显示 `[]`。`make dev-stop` 只停止开发；`make services-stop` 也会中断当前平台/浏览器验证。停止命令通过本机控制 socket 联系持有子进程句柄的启动器，不使用磁盘 PID 杀进程。过期记录由对应 stop 命令清理；未知占用方需先核对端口、PID、cwd 和启动来源。

这些命令不接管 Docker、旧启动器或其他仓库的服务。SIGKILL、系统崩溃无法执行退出钩子，可能留下 `stale` 记录和进程；此时 stop 只清除失效记录，不冒险按旧 PID 结束进程，需核对实际监听者后处理。不要直接删除正在使用的状态目录。

`make test` 包含随机端口上的生命周期回归，其中包装进程退出回归使用独立根目录、状态记录和数据目录，覆盖 API/Web 包装进程退出后后代仍持有输出管道、启动中退出和超时强制清理，已有开发会话运行时也可执行。`make test SUITE=services` 还使用临时数据启动真实 Go/Vite，验证后台就绪、重复启动保护、代理、中断、端口冲突和部分失败清理。若已有受管开发会话，该开发烟测会明确跳过，避免中断工作；生命周期回归仍执行。

## Web 样式

`apps/web` 使用 Tailwind CSS 4，通过 `@tailwindcss/vite` 接入 Vite，精确版本以该应用的 `package.json` 和根锁文件为准。入口为 `apps/web/src/style.css`，加载 Tailwind 默认主题与工具类，Vite 构建时扫描源码中的类名并生成 CSS；无需 CDN、PostCSS 配置或旧版 `tailwind.config.js`。

现有样式位于 `components` 层，Tailwind 的 `utilities` 层可覆盖它们。为保留当前标题、表单和其他元素的浏览器默认样式，暂不加载 Preflight；页面迁移时再统一评估全局重置。新增样式可直接使用静态工具类，例如 `className="flex gap-4"`，不要拼接 `bg-${color}-500` 一类无法完整扫描的类名。

修改 Web 样式或组件前，读取[现行设计规范](../DESIGN.md)。主题接入、字体来源及历史设计稿的适用范围见[设计来源与主题接入](design-reference.md)。
