# 本地验收交付页

读取各项目原位保存的 `.acceptances/` Round，在本机浏览器展示跨轮验收主页，并把逐项人审写回对应 Round 的 `reviews.json`。不上传 LobeHub，不改 `result.json`、`report.md` 或 `assets/`。

## 首次准备

```bash
cd /Users/chulan/project/my-project/acceptances
bun install
```

日常验收使用开发服务。先检查是否已经运行：

```bash
curl --noproxy '*' -fsS http://127.0.0.1:5173/api/health
```

返回 `{"ok":true}` 时直接复用。否则启动：

```bash
cd /Users/chulan/project/my-project/acceptances
bun run dev
```

Vite 页面使用 `http://127.0.0.1:5173`，Node API 使用 `127.0.0.1:8767`。数据清单保存在 `~/.local/share/acceptances/catalog.json`。服务避开产品端口，例如 cpp-admin 的 8005。

## 在任意项目运行自动回归

在待验收项目根目录向 Codex 发出请求：

```text
使用 $acceptance-cl 对 <功能或页面> 做本地自动回归。只写本地 Round，不要 ingest；遇到登录或 token 权限问题，立即停下向我索取 token。
```

Agent 应按以下顺序执行：

1. 读取项目的 `.agents/acceptance/PROJECT.md`；存在 `PROCESS.md` 或 `common-mistakes.md` 时一并读取。
2. 写出可由人判断的 `plan[]`，再启动或复用产品服务。
3. 检查目标页面、登录态和真实路由。认证失败时执行下方“认证阻断”。
4. 用 `agent-browser` 完成页面操作并把证据写入新的 Round。
5. 在交付前校验并封存新 Round：

   ```bash
   node /Users/chulan/project/my-project/acceptances/bin/cli.js validate \
     /absolute/path/to/project/.acceptances/<subject>/<round> --seal
   ```

6. 在项目根目录登记 `.acceptances/`：

   ```bash
   node /Users/chulan/project/my-project/acceptances/bin/cli.js register "$PWD"
   ```

7. 启动或复用本项目的 5173 服务，把本地交付页 URL 和 `coverage: N/N` 交给用户。

每次修复后重新验证都创建新 Round，不覆盖旧证据。`result.json` 记录机器跑测结论，`reviews.json` 只记录交付页上的人审。

## 配置项目特殊要求

需要指定启动方式、路由、登录或测试数据时，在待验收项目创建 `.agents/acceptance/PROJECT.md`。推荐模板：

```markdown
# Acceptance adapter

## Environment

- Project root: /absolute/path/to/project
- Start command: <command>
- Base URL: http://localhost:<port>
- Existing service check: <command>
- Stop rule: 只停止本轮 Agent 自己启动的进程

## Web surface

- agent-browser session: <project-session>
- Viewport: 1920 1080
- Entry URL: http://localhost:<port>/<path>
- Success anchors: <页面上必须出现的文字或控件>

## Authentication

- Provider: AMC
- Storage key: token
- Signed-in probe: 只返回 URL、host 和 token 是否存在，不返回 token 内容
- API probe: <登录后必须非 401/403 的接口>
- Blocking rule: token 缺失、跳转登录页或接口返回 401/403 时，停止并向用户索取完整 localStorage.token

## Test data

- <允许使用的数据与清理规则>
```

项目适配层只记录本项目特有事实，不写 token、密码或其他凭据。Round schema、登记命令和交付页行为以本 README 与全局 `acceptance-cl` 为准。

## 认证阻断：AMC 和 localStorage.token

第三方登录不适合自动化时，Agent 必须把认证当成阻断点，而不是继续点击登录页。

触发任一条件就立即停止当前页面操作：

- `localStorage` 中缺少项目适配层指定的 token。
- 页面跳转到 AMC 或其他登录域。
- 登录探针或业务接口返回 401/403，并且项目适配层判定为认证问题。

Agent 此时应直接询问：

> 当前页面缺少有效登录态。请提供 `localStorage.token` 的完整字符串；我只会注入当前本地会话，不会打印、复制到文件或写入验收证据。

收到 token 后再继续：

1. 打开产品的原始站点，例如 `http://localhost:8005/`。必须先进入正确 origin，再写 localStorage。
2. 把用户提供的完整值写入项目适配层指定的 key。cpp-admin 示例：

   ```bash
   agent-browser --session <project-session> storage local set token '<完整 localStorage.token>'
   agent-browser --session <project-session> reload
   ```

3. 只做布尔和站点探针，不读取或输出 token：

   ```bash
   agent-browser --session <project-session> eval 'JSON.stringify({ url: location.href, host: location.host, hasToken: !!localStorage.getItem("token") })'
   ```

4. 确认 `hasToken` 为 `true`、host 仍是产品域，并且项目适配层指定的 API 不再返回 401/403，随后恢复回归。

token 仍无效时再次停止，请用户刷新 token。Agent 不点击 AMC 登录、不读取 `.env*`，也不把 token 写入命令输出、截图、HAR、Round、Git 或文档。原始 HAR 用完即删除；需要网络证据时只保存脱敏后的请求路径、状态码和 payload。

日常验收由全局 `acceptance-cl` 直接调用本项目。

## 直接使用 CLI

不通过 skill 时也可以手工登记和启动生产构建：

```bash
cd /Users/chulan/project/my-project/acceptances
bun run build
node bin/cli.js register /absolute/path/to/project
node bin/cli.js validate /absolute/path/to/project/.acceptances --json
node bin/cli.js validate /absolute/path/to/project/.acceptances/<subject>/<round> --seal
node bin/cli.js serve --open
```

生产服务默认监听 `127.0.0.1:8765`。

## 页面语义

- `/subject?root=...&subject=...`：跨轮 union。相同检查项按稳定 `id` 合并。
- `/subject?...&r=2`：第 2 轮不可变快照。
- 最新 plan 没有对应 case 时显示“未执行”，且不能人审。
- 每项显示最近证据、结构化可视化、人审和迭代历史。
- `reviews.json` 是唯一写回文件。拒绝必须填写评论。
- 未封存的旧 Round 显示为 `legacy`，不进入跨轮 union 或人审。
- `held` Round 可查看和拒绝，但不能验收通过；`rejected` Round 只显示校验诊断。
- Published Round 的摘要记录在 `.acceptances/.meta/`，Raw Round 改变后会显示 `ROUND_TAMPERED`。

## 边界

React 只消费 `/api` JSON，不导入 Node 模块。Node 服务独占文件系统、catalog、资产读取和人审写回。未来迁到 Next.js 时可替换 API 实现和页面入口，Round 数据契约不变。

本项目暂不包含数据库、鉴权、多用户、云同步、自动下一轮或 LobeHub 源码。
