# Acceptances

本地优先的验收报告查看器和 Round 校验工具。

Acceptances 读取项目原位保存的 `.acceptances/` 目录，在浏览器中展示自动回归结果、证据和多轮修复历史，并把人工验收结论写入对应 Round 的 `reviews.json`。

所有数据都保留在本机。服务只监听 `127.0.0.1`，不会上传 Round、截图、测试数据或人工评论。

> 当前版本为 `0.1.0`，适合在本地查看和审核由自动化工具生成的验收 Round。

## 为什么需要 Acceptances

测试通过不等于功能可以交付。单元测试、类型检查和构建证明代码满足机器规则，页面状态、业务结果和音视频效果仍可能需要人来判断。

Acceptances 将两类结论分开记录：

- `result.json` 保存自动回归产生的事实。
- `reviews.json` 保存人工的接受或拒绝决定。
- 每次修复创建新的 Round，不覆盖旧证据。
- 已封存的 Round 通过内容摘要检测事后修改。

## 核心能力

- 在一个本地页面中浏览多个项目的验收记录。
- 展示截图、文本、JSON、音频、视频和结构化可视化证据。
- 按稳定检查项合并同一 Subject 的多轮结果。
- 保留指定 Round 的不可变快照和跨轮迭代历史。
- 对检查项执行人工接受或拒绝，拒绝时必须填写原因。
- 校验 Round 的结构、证据完整性、安全边界和历史关系。
- 封存可发布的 Round，并检测封存后的内容变化。
- 隔离 `ready`、`held`、`rejected` 和 `legacy` 状态，阻止不完整记录进入正式人审。

## 快速开始

### 环境要求

- Node.js 20 或更高版本
- [Bun](https://bun.sh/)

### 安装

克隆仓库后安装依赖：

```bash
cd acceptances
bun install
```

### 构建并启动

```bash
bun run build
node bin/cli.js serve --open
```

生产服务默认运行在 <http://127.0.0.1:8765>。

### 登记项目

待登记项目必须包含 `.acceptances/` 目录：

```bash
node bin/cli.js register /absolute/path/to/project
```

查看当前登记清单：

```bash
node bin/cli.js list
```

刷新本地页面后即可查看该项目的 Subject 和 Round。

## 校验和封存 Round

`validate` 可以接收单个 Round、Subject 目录或完整的 `.acceptances/` 目录：

```bash
node bin/cli.js validate /path/to/project/.acceptances
```

输出 JSON 结果：

```bash
node bin/cli.js validate /path/to/round --json
```

校验完成后封存 Round：

```bash
node bin/cli.js validate /path/to/round --seal
```

`ready` 和 `held` Round 可以封存，`rejected` Round 不会写入 Receipt。命令对 `ready` 返回退出码 `0`，对 `held` 或 `rejected` 返回 `1`，调用错误返回 `2`。

校验结果分为：

| 状态       | 含义                                     |
| ---------- | ---------------------------------------- |
| `ready`    | 满足发布规则，可以进入人工验收           |
| `held`     | 可以查看，但缺少完成验收所需的证据或信息 |
| `rejected` | 数据结构、安全规则或历史关系不合法       |
| `legacy`   | 尚未使用当前 Ruleset 封存的旧 Round      |

完整规则见 [Acceptance validator rule matrix](docs/acceptance-validator-rules.md)。

## 工作模型

一个 Subject 可以包含多个 Round。每个 Round 都是某一时刻的完整验证快照。

1. 自动化工具创建 Draft Round，并写入结果、报告和证据。
2. `validate --seal` 校验并封存 Round。
3. 封存后的 Published Round 进入本地交付页。
4. 人工接受或拒绝每个检查项，结论写入 `reviews.json`。
5. 功能修复后创建新 Round，通过 `supersedes` 连接上一轮记录。

Validator 不改写原始 Round。人工验收也不会修改 `result.json`、`report.md` 或 `assets/`。领域术语见 [GLOSSARY.md](GLOSSARY.md)。

## 页面行为

- 跨轮总览按稳定检查项 ID 合并最近一次执行结果。
- 指定 Round 页面保留该轮的不可变快照。
- 计划中存在但没有产生 case 的检查项显示为“未执行”，不能人审。
- `held` Round 可以查看和拒绝，但不能验收通过。
- `rejected` 和 `legacy` Round 不进入跨轮总览或正式人审。
- Published Round 的 Receipt 保存在 `.acceptances/.meta/`。原始内容改变后会产生 `ROUND_TAMPERED` 诊断。

## CLI 参考

```text
node bin/cli.js register [path]     登记项目或 .acceptances 目录
node bin/cli.js unregister [path]   从本地清单移除，不删除 Round
node bin/cli.js list                查看已登记目录
node bin/cli.js validate <path>     校验 Round、Subject 或 .acceptances
node bin/cli.js serve               启动本地交付页
```

可用参数：

```text
validate --json                 输出结构化校验结果
validate --seal                 校验通过后封存 Round
serve --port <number>           指定监听端口
serve --open                    启动后打开浏览器
```

直接查看完整帮助：

```bash
node bin/cli.js --help
```

## 安全与隐私

Acceptances 按单用户、本地使用设计：

- HTTP 服务只绑定 `127.0.0.1`。
- API 只接受本机 Host 和 Origin。
- 只有登记到 catalog 的 `.acceptances/` 目录可以被读取。
- 人工验收只写入对应 Round 的 `reviews.json`。
- Validator 拒绝 HAR、环境文件、路径穿越、符号链接逃逸和疑似未脱敏凭据。
- Catalog 保存在 `~/.local/share/acceptances/catalog.json`，不写入被验收项目。

当前版本没有身份认证或多用户权限。不要通过反向代理、端口转发或修改监听地址把服务暴露到公网。

## 与自动化工具集成

本仓库负责校验、展示和人工审核，不负责驱动浏览器或生成业务回归步骤。任何自动化工具都可以生成 Round，只要输出满足当前 Ruleset。

项目专用的启动命令、页面入口、认证方式和测试数据约束应保存在被验收项目中，不要把 token、密码或其他凭据写入 Round、截图、日志或 Git。

### 使用 Codex 自动创建 Round

仓库在 [`.agents/skills/acceptance-cl`](.agents/skills/acceptance-cl/SKILL.md) 中维护 `$acceptance-cl`。它让 Codex 规划本地验收、收集证据、创建 Round、调用共享 Validator，并交付本地人审页面。

核心 CLI 和页面不依赖该 skill。已有 Round 或使用其他自动化工具时，可以跳过本节，直接使用前面的 CLI 命令。

#### 1. 安装 skill

Codex 在当前 Acceptances 仓库中会自动发现仓库级 skill。但实际验收通常从另一个业务仓库发起，因此需要把它安装到用户级 Skills。

如果保留本仓库的本地克隆，推荐使用符号链接。这样仓库更新后，skill 和 CLI 会一起更新。在 Acceptances 仓库根目录执行：

```bash
mkdir -p "$HOME/.agents/skills"
ln -s "$(pwd)/.agents/skills/acceptance-cl" \
  "$HOME/.agents/skills/acceptance-cl"
```

创建链接前确认 `~/.agents/skills/acceptance-cl` 不存在。macOS 和 Linux 可以使用上述命令。也可以通过 `$skill-installer` 从本 GitHub 仓库安装 skill；这种方式需要另外把 `acceptances` 命令加入 `PATH`，或者配置下方的 `ACCEPTANCES_CLI`。

Skill 随附的解析器按以下顺序查找 CLI：

1. `ACCEPTANCES_CLI` 指向的 `bin/cli.js`。
2. 与仓库内 skill 同版本的 `bin/cli.js`。
3. `PATH` 中的 `acceptances` 命令。

复制安装 skill 且没有全局 CLI 时，可以显式指定：

```bash
export ACCEPTANCES_CLI="/absolute/path/to/acceptances/bin/cli.js"
```

该变量只保存 CLI 文件位置，不应包含 token、密码或其他凭据。Codex 没有立即显示新 skill 时，重新启动 Codex。加载位置和符号链接支持见 [OpenAI Skills 文档](https://developers.openai.com/codex/skills)。

#### 2. 配置业务项目

进入需要验收的业务仓库。若项目有固定的启动方式、页面入口、认证流程或测试数据，在业务仓库创建 `.agents/acceptance/PROJECT.md`：

```markdown
# Acceptance adapter

- Start command: <启动命令>
- Base URL: <本地服务地址>
- Entry URL: <需要验收的页面>
- Authentication: <手动登录或安全的会话注入方式>
- Test data: <允许使用的数据和清理规则>
```

不要在适配文件中写入 token、密码或其他凭据。没有项目特殊要求时，可以省略该文件。

#### 3. 发起本地验收

从业务仓库打开 Codex，并明确调用 skill：

```text
使用 $acceptance-cl 对 <功能或页面> 做本地验收。
```

Skill 会在业务仓库中执行以下流程：

1. 读取项目适配层并形成可人工判断的验收计划。
2. 操作目标页面或 CLI，收集脱敏证据。
3. 在业务仓库的 `.acceptances/` 下创建新 Round。
4. 校验并封存 Round，随后登记当前业务仓库。
5. 启动或复用 <http://127.0.0.1:8765>，返回覆盖率和本地验收页面。

#### 4. 完成人工审核

打开 Skill 返回的本地页面，对检查项执行接受或拒绝。人工结论只写入对应 Round 的 `reviews.json`，不会改写自动回归结果或证据。

## 开发

启动开发服务：

```bash
bun install
bun run dev
```

开发环境使用以下地址：

- Vite 页面：<http://127.0.0.1:5173>
- Node API：<http://127.0.0.1:8767>

运行完整检查：

```bash
bun run check
```

该命令依次运行 ESLint、TypeScript 类型检查、Node 测试和 Vite 生产构建。

## 架构边界

React 页面只消费本地 `/api` JSON。Node 服务负责文件系统访问、catalog、资产读取、校验和人工评论写回。CLI 和页面共享同一个 Validator，避免产生两套规则。

当前版本不包含：

- 数据库和远程存储
- 用户认证和多用户权限
- 云端上传或同步
- 自动创建下一轮 Round
- LobeHub Cloud 的数据库、鉴权和未公开行为

本项目只实现公开、确定、可在本地观察的 Round 规则。兼容范围、假设和取舍见 [ADR-0001](docs/adr/0001-public-acceptance-validator.md)。本项目不是 LobeHub 官方项目，也不代表双方存在隶属或合作关系。

## 贡献

欢迎提交 Issue 和 Pull Request。提交代码前请运行：

```bash
bun run check
```

涉及 Round 数据契约、Ruleset 或历史语义的修改，请在 Pull Request 中说明兼容性影响，并同步更新规则矩阵或 ADR。

## 许可证

2026-10-08 许可说明更新：历史功能说明保留，许可状态以根 [LICENSE](LICENSE)、[LICENSE-SCOPE.md](LICENSE-SCOPE.md)和 [NOTICE](NOTICE)为准。本仓库按内容区分许可，没有统一 MIT 授权。

旧 acceptance-cl 模板／文档及部分 validator 规则经 AI 参考 LobeHub 后改写，沿用／改写表达保留固定提交 `1c7a7116313bcc2d675937139554a244f7adf7a0` 的 [Community License](LICENSES/LobeHub-Community-1c7a711.txt)与 [Apache 2.0 正文](LICENSES/Apache-2.0.txt)，保留 LobeHub LLC 原版权声明。旧 renderer、本地新增表达和完整衍生边界仍待核实，不能据此宣称整文件 MIT。公开分发范围尚未确认，A35 仍 blocked。

候选 MIT 版权署名已确认为 `Copyright (c) 2026 acceptances`；具体原创授权范围仍 pending，当前无项目原创 MIT 生效范围。署名确认不等于旧实现或上游内容可按 MIT 分发。
