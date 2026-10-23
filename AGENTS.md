## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, label strings equal to role names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the repo root and ADRs in `docs/adr/`. See `docs/agents/domain.md`.

### Verification

Before choosing checks or reporting verification results, read [the toolchain guide](docs/toolchain.md) for command coverage and evidence boundaries. For product acceptance, follow [the T1–T9 handoff](docs/v1-implementation-handoff.md).

### Browser regression

浏览器回归默认由 Agent 使用用户指定的真实浏览器工具完成，例如 Codex `@Chrome`、Claude in Chrome 或 `ego-browser`；沿用获授权的页面与登录状态。未指定工具时，按当前环境可用的浏览器技能选择。

不要默认启动 Playwright、Playwright MCP 或独立的 Playwright 浏览器，也不要自动运行 `pnpm test:browser`、`make test SUITE=browser` 或 `scripts/v1/browser-check.mjs`。已有 Playwright 脚本仅在用户明确要求执行该类脚本回归时运行；笼统的“浏览器回归”不等于此授权。浏览器工具不可用或验证失败时，说明阻塞，不自动改用 Playwright。

Jev 接入应通过选定浏览器工具已公开的接口完成观察与操作；接入不可用时继续使用原工具或报告阻塞，不切换到 Playwright。以实际页面状态、交互结果及必要的 API 响应判断结果；动作回执或模型返回 `DONE` 不代表验收通过。提交评审、删除等写操作使用专用合成数据，未经明确授权不得操作日常报告。

用户选择真实 Chrome + Jev、配置 Key 或使用 Docker 执行器时，先读 [Jev 接入与任务合同](docs/agents/jev-browser.md)。通过 `make jev-config` 创建根目录 `.env`，由项目启动器加载 Jev 变量并注入执行进程；Agent 不读取或打印 `.env*` 内容。宿主机使用 `make jev-inspect` / `make jev-run`，Docker 使用对应的 `jev-docker-*` 入口；均连接真实 Chrome，不替换 `@Chrome` 或 Claude 插件内部模型。

### UI changes

Before changing UI styles or components, read [the design standards](DESIGN.md). For theme integration, font provenance, or historical design references, see [the design reference](docs/design-reference.md).
