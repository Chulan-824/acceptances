# Acceptances 设计稿与主题

2026-10-10 通过设计 MCP 读取并确认，代码目录为本仓库，主题入口为 `apps/web/src/style.css`。

## 设计来源

- 项目：Acceptances 本地验收查看器
- 项目 ID：`43956615-b9b9-4f7a-9712-611dcf46801d`
- 页面：`index.html`，验收查看器为 `acceptances-viewer.html`
- 主题：Modern Slate，`modern-slate`，设计版本 `1.0.0`
- 令牌来源：`assets/theme.json`，辅助参考 `assets/tailwind-theme.js` 和 `brand-spec.md`

后续读取设计时，显式指定项目 ID，通过 `get_artifact` 获取页面与关联资产。本记录建立代码与设计来源的对应关系，不会自动同步设计变化，也不修改设计工具的代码目录关联。

## Tailwind 4 映射

设计原型使用 CDN 和 Tailwind 3 的浏览器配置。当前应用继续使用已安装的 Tailwind 4 与 Vite 插件，通过顶层 `@theme static` 声明主题。所有项目令牌都会输出为 CSS 变量，工具类按源码实际使用生成。

| 设计含义       | CSS 变量                                                                      | 工具类示例                                                                  |
| -------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 画布、表面     | `--color-canvas`、`--color-surface`                                           | `bg-canvas`、`bg-surface`                                                   |
| 次级表面、悬停 | `--color-surface-subtle`、`--color-surface-hover`                             | `bg-surface-subtle`、`hover:bg-surface-hover`                               |
| 文本层级       | `--color-fg`、`--color-fg-secondary`、`--color-fg-muted`、`--color-fg-subtle` | `text-fg`、`text-fg-secondary`、`text-muted`                                |
| 边框           | `--color-border`、`--color-border-dark`                                       | `border-border`、`border-border-dark`                                       |
| 品牌交互       | `--color-brand`、`--color-brand-hover`、`--color-brand-fg`                    | `bg-brand`、`hover:bg-brand-hover`、`text-brand-fg`                         |
| 通过           | `--color-accent` 及 `-soft`、`-border`、`-dark`                               | `bg-accent-soft text-accent-dark border-accent-border`                      |
| 待验、警告     | `--color-warning` 及 `-soft`、`-border`、`-dark`                              | `bg-warning-soft text-warning-dark`                                         |
| 失败、拒绝     | `--color-danger` 及 `-soft`、`-border`、`-dark`                               | `bg-danger-soft text-danger-dark`                                           |
| 字体           | `--font-sans`、`--font-mono`                                                  | `font-sans`、`font-mono`                                                    |
| 圆角           | `--radius-sm/default/md/lg/full`                                              | `rounded-sm`、`rounded-default`、`rounded-md`、`rounded-lg`、`rounded-full` |
| 阴影           | `--shadow-subtle/card/dropdown/elevated/window`                               | `shadow-subtle`、`shadow-card`、`shadow-dropdown`、`shadow-window`          |

`text-muted` 与 `text-fg-muted` 使用相同值，兼容原型的两种类名。圆角与 card 阴影以机器令牌 `theme.json` 为准；`elevated` 是 `dropdown` 的同值别名，`window` 补充自原型配置。默认 Tailwind 色阶与间距仍可使用。

现有页面的文字、背景、表单、状态徽章和弹窗引用主题变量。保留 Preflight 策略。状态配色只影响展示，不改变 Project → Campaign → Run 的状态与人工评审契约。

## 三栏验收工作台

项目内采用左侧需求导航、中间报告与人工反馈、右侧运行记录的布局。选择需求默认展示其最新 Run，也可通过右侧切换历史 Run；若服务返回的 latestRunId 为空但仍有历史记录，默认回退展示列表中的第一条历史 Run，仍标为历史报告，不改变需求状态。显式 Run URL 和浏览器前进、后退仍可使用。项目管理入口保留项目详情、代码来源、创建需求和删除项目，顶部保留所有项目与项目选择。

需求搜索匹配标题与说明，并与待审、已接受、已拒绝筛选组合。检查项搜索匹配 ID、标题、预期与实际结果，状态沿用 passed、failed、blocked、skipped。计数展示当前完整列表的数量，筛选结果另显示命中数；无匹配结果不改变当前选中的报告。

通过的检查项默认收起，其他检查项默认展开。检查项内部复用附件预览组件；图片可通过原生 dialog 放大，Esc 或关闭按钮退出并返回触发控件，文本通过同一附件接口读取并作为纯文本展示，仅预览前 64 KiB，不解析 HTML；完整内容可打开原文件或下载。完整附件列表与下载入口保留，未关联到检查项的附件仍可访问。

宽屏展示三栏；中等宽度将运行历史移至报告下方，窄屏按需求导航、报告、运行历史排列。侧栏长列表可滚动，不隐藏创建、评审或历史入口。

所有数据继续来自现有 Project、Campaign、Run、Review 与 Evidence 接口，不新增字段、存储、测试执行或原型中的 reviews.json 写入机制。反馈、接受、拒绝、作废和删除后刷新相关列表；删除最新 Run 后遵循服务返回的需求状态，不恢复旧人工决定。

设计资产中的 `init_theme_preset` 与 `npx acceptances theme init` 是原型文案，不是本项目已注册的工具或 CLI 命令，不据此安装依赖或执行命令。

## 报告摘要与评审入口

报告顶部将本次检查结果、附件数量与此 Run 最近一次接受或拒绝决定集中展示。补充说明不覆盖最近决定；作废状态及原因独立保留。检查数量来自各自 Run 的完整 checks，不受搜索筛选影响，也不合并其他 Run。运行历史使用同一计数组件展示通过、失败、阻塞和未执行数量。

页面底部固定显示当前或历史报告状态及评审入口，通过原生 dialog 录入补充说明、接受或拒绝。原反馈列表、作废及删除入口保留。历史报告决定仍不改变需求当前状态，作废 Run 仅允许补充说明。保存失败时弹窗保留输入并显示错误；关闭或 Esc 不取消已发送的请求。页面与窄屏历史列表预留底部空间，避免固定栏遮挡最后的内容。
