# 工具链与验证命令

运行时及镜像 digest 保留在 `toolchain.lock.json`，Go 依赖以 `go.mod/go.sum` 为准，JavaScript 依赖以 `pnpm-lock.yaml` 为准。当前锁定 Go 1.26.8、Node 26.7.0、pnpm 12.4.2、TypeScript 5.9.3。SQLite 随 Go 应用交付，不需要 PostgreSQL、sqlc、数据库密码或云 SDK。

| 命令                       | 行为                                                           |
| -------------------------- | -------------------------------------------------------------- |
| `make dev`                 | 启动 Go 与 Vite，自动初始化 `.cache/dev-data`，Ctrl-C 停止两者 |
| `make fmt`                 | 格式化当前应用、配置、脚本和接入文档                           |
| `make lint`                | Prettier、ESLint、go vet 和 gofmt 检查                         |
| `make typecheck`           | Web 与客户端类型检查                                           |
| `make build`               | 构建 Web、服务和当前平台 CLI                                   |
| `make test`                | 所有 Go 测试，以独立临时数据验证 HTTP/CLI 行为                 |
| `make test SUITE=http`     | HTTP 集成测试                                                  |
| `make test SUITE=cli`      | CLI 外部行为测试                                               |
| `make test SUITE=agent`    | 接入辅助工具与 CLI 测试                                        |
| `make test SUITE=platform` | 已构建二进制、临时数据初始化、Web 静态资源及正常停机           |
| `make test SUITE=e2e`      | 调用外部真实浏览器驱动并校验回执                               |
| `make docker-up`           | 构建并启动单容器，不删除已有卷                                 |
| `make install-skill`       | 安装宿主机 CLI 和 skill                                        |

旧 DTO、OpenAPI 和 sqlc 生成流程已移除。未知测试分组返回非零，不将未运行标记为通过。

构建前执行 `pnpm install --frozen-lockfile --ignore-scripts`。Make 使用精确 `GOTOOLCHAIN`，Go 缓存位于 `.cache`。首次构建可能下载工具链和依赖。

运行验证按静态检查、进程内 HTTP 集成、原生进程、Docker、真实浏览器分别报告。归档源码 commit、dirty 状态、构建产物摘要、命令和实际结果；仅在本机执行不代表其他架构已验证。真实产品验收按 [T1–T9 交接](v1-implementation-handoff.md) 逐项记录。

## Web 样式

`apps/web` 使用 Tailwind CSS 4，通过 `@tailwindcss/vite` 接入 Vite，精确版本以该应用的 `package.json` 和根锁文件为准。入口为 `apps/web/src/style.css`，加载 Tailwind 默认主题与工具类，Vite 构建时扫描源码中的类名并生成 CSS；无需 CDN、PostCSS 配置或旧版 `tailwind.config.js`。

现有样式位于 `components` 层，Tailwind 的 `utilities` 层可覆盖它们。为保留当前标题、表单和其他元素的浏览器默认样式，暂不加载 Preflight；页面迁移时再统一评估全局重置。新增样式可直接使用静态工具类，例如 `className="flex gap-4"`，不要拼接 `bg-${color}-500` 一类无法完整扫描的类名。

项目主题变量集中在同一 CSS 入口的顶层 `@theme static` 中定义，已接入设计稿的 Modern Slate 配色、字体、圆角和阴影；所有项目变量均输出，工具类仍按源码使用生成。设计来源、令牌映射与后续读取方式见[设计稿与主题](design-reference.md)。现有页面通过变量使用主题，完整页面布局迁移另行落实。
