# Acceptances 设计稿与主题

2026-10-10 通过设计 MCP 读取并确认，代码目录为本仓库，主题令牌位于 `apps/web/src/theme.css`，工作台入口为 `apps/web/src/style.css`。

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

## 项目首页

2026-10-11 通过 OpenDesign MCP 的 `get_artifact`，显式指定项目 ID `43956615-b9b9-4f7a-9712-611dcf46801d`，读取用户已确认的 `homepage-redesign.html`。原生成 run 为 `7e9412d8-aac0-48b3-822b-f6c048231147`。首页在既有 Modern Slate 系统内调整布局与局部字号，继续复用 `apps/web/src/style.css` 的主题，不新增全局设计令牌。

- 实现对应：`apps/web/src/main.tsx` 负责首页路由、项目列表加载和创建后的进入；`home.tsx` 负责项目列表及折叠创建表单，`home.css` 负责首页局部样式。方向契约见 `apps/web/.impeccable/surfaces/apps-web-src-main-tsx.md`。
- 桌面布局：居中容器最大宽度 1120px、左右内边距各 32px，顶栏最小高度 72px。项目列表为主区，创建区宽 320px、两区间隔 32px；白色项目卡片与折叠表单使用细边框。
- 桌面约定：页面最小宽度 1120px，创建表单默认展开；较窄窗口横向滚动，不提供移动端重排。首页 h1 为 28px，项目名称为 18px。

首页移除原稿的 mock 预览提示。项目列表来自 `GET /api/v1/projects`，卡片进入 `/projects/:id`，产品介绍进入 `/landing.html`。创建表单通过现有客户端发送 `POST /api/v1/projects`，成功刷新列表并自动进入新项目，失败保留名称与说明。名称必填、最多 200 字符，说明选填；加载、空态与列表失败重试分别展示。提交中禁用字段与提交按钮，防止重复提交，并保留当前表单展开状态。Enter 可提交名称字段；非提交状态按 Esc 收起表单并返回折叠标题焦点，空态入口展开表单并聚焦名称。

本次浏览器检查覆盖 1440px、1024px、390px，当前 691px 视口无横向溢出；独立临时数据库及 8766 服务验证真实创建、进入项目、200 字名称和多项目手机布局。创建失败保留输入并可恢复后重试，列表 HTTP 503 显示错误且重试恢复，延迟真实创建期间观察到字段禁用与进行中提示，成功后自动进入项目。本地验证记录见 `artifacts/homepage-ui/verification.json`，此目录不进入 Git；临时服务已停止，常规开发入口仍按 README 使用。Go 测试与 `make lint typecheck build` 通过，Impeccable 完成审查结果为 `ship`。这些结果属于首页重构验证，不代表已有业务 Run 获得人工接受。

## 三栏验收工作台

项目内采用左侧需求导航、中间报告与人工反馈、右侧运行记录的布局。2026-10-11 再次读取 `acceptances-viewer.html` 与关联资产，按稿内的整屏结构调整工作台：桌面三栏占满视口，左栏 256px、右栏 288px，中间自适应，报告内容最大宽度 896px；三栏分别滚动。项目选择与“所有项目”入口放在左栏，创建项目表单仅保留在首页。项目设置入口保留项目详情、代码来源、创建需求和删除项目。

选择需求默认展示其最新 Run，也可通过右侧切换历史 Run；若服务返回的 latestRunId 为空但仍有历史记录，默认回退展示列表中的第一条历史 Run，仍标为历史报告，不改变需求状态。显式 Run URL 和浏览器前进、后退仍可使用。

需求搜索匹配标题与说明，并与待审、已接受、已拒绝筛选组合。检查项搜索匹配 ID、标题、预期与实际结果，状态沿用 passed、failed、blocked、skipped。计数展示当前完整列表的数量，筛选结果另显示命中数；无匹配结果不改变当前选中的报告。

通过的检查项默认收起，其他检查项默认展开。检查项内部复用附件预览组件；图片可通过shadcn Dialog 放大，Esc 或关闭按钮退出并返回触发控件，文本通过同一附件接口读取并作为纯文本展示，仅预览前 64 KiB，不解析 HTML；完整内容可打开原文件或下载。完整附件列表与下载入口保留，未关联到检查项的附件仍可访问。

页面最小宽度 1120px，三栏始终保留 256px 左栏与 288px 右栏。侧栏和正文独立滚动，较窄窗口横向滚动。

所有数据继续来自现有 Project、Campaign、Run、Review 与 Evidence 接口，不新增字段、存储、测试执行或原型中的 reviews.json 写入机制。反馈、接受、拒绝、作废和删除后刷新相关列表；删除最新 Run 后遵循服务返回的需求状态，不恢复旧人工决定。

设计资产中的 `init_theme_preset` 与 `npx acceptances theme init` 是原型文案，不是本项目已注册的工具或 CLI 命令，不据此安装依赖或执行命令。

## 报告摘要与评审入口

报告顶部将本次检查结果、附件数量与此 Run 最近一次接受或拒绝决定集中展示。补充说明不覆盖最近决定；作废状态及原因独立保留。检查数量来自各自 Run 的完整 checks，不受搜索筛选影响，也不合并其他 Run。运行历史使用同一计数组件展示通过、失败、阻塞和未执行数量。

报告栏底部固定显示当前或历史报告状态及评审入口，定位于工作台底部中栏，不遮挡两侧导航；通过shadcn Dialog 录入补充说明、接受或拒绝。原反馈列表、作废及删除入口保留。历史报告决定仍不改变需求当前状态，作废 Run 仅允许补充说明。保存失败时弹窗保留输入并显示错误；关闭或 Esc 不取消已发送的请求。报告预留底部空间，避免固定栏遮挡最后的内容。

## 独立落地页

2026-10-11 通过 OpenDesign MCP 的 `get_artifact` 读取同一项目的 `landing.html`，同时取得 `assets/tailwind-theme.js`、`assets/theme-modal.js`、`assets/landing.js`；通过 `get_file` 补充读取弹窗使用的 `assets/theme.json`。MCP 不返回图片二进制，三张展示图从 MCP 确认的本地项目目录复制，未重绘或压缩。

- 页面入口：`apps/web/landing.html`，开发和生产 URL 均为 `/landing.html`。现有项目首页增加“产品介绍”入口。
- 页面交互：`apps/web/src/landing/main.tsx`，包括三张截图切换、图片放大和启动命令复制；shadcn Dialog 负责焦点圈定、Esc 关闭，组件显式恢复触发控件焦点。
- 本地资源：`apps/web/public/landing/`，保留原始截图；设计规范入口、主题弹窗及其专用 JSON 已于 2026-10-13 移除，页面继续使用共享主题样式。
- 样式：`apps/web/src/landing/landing.css` 加载必要的 `landing-base.css` 浏览器重置、共享主题和组件样式。旧 `landing-design.css` CSSOM 快照已移除，工具类由 Tailwind 4 生成。Vite 单独打包此入口，不加载工作台样式，不使用运行时 CDN，不增加 Tailwind 3 依赖。

2026-10-12 用户要求所有页面使用现有 Tailwind 主题及 shadcn/ui。Landing Page 的 `landing.css` 使用精简的 base 层，并加载共享 `theme.css` 与 `ui.css`。圆角统一使用当前 Tailwind 4 的 8px/12px 令牌；不引入工作台的全局 section、header 规则。原稿的 Tailwind 3 圆角属于此前版本记录。

导航、首屏、产品全景、核心特性、交付流程、目录规范、对比表、底部行动区与页脚均保留稿内布局及文案。按本次用户要求，中枢和查看器链接保留稿内固定地址，并通过 `data-pending-link` 阻止跳转；页内锚点照常工作，目标路由待用户逐一确认。原稿中的 PID、文件读取与签署机制、命令和示例数据属于设计内容，不代表当前产品新增了相应能力，产品事实继续以 PRODUCT.md 与 ADR-0001 为准。

更新设计时应重新获取完整落地页资产，在浏览器打开原稿并触发所有展示页签和复制提示，再将所需变更同步到 React 页面与共享主题，格式化并对比截图。主题与组件迁移后仍需核对实际截图与交互，构建成功不能替代页面验证。验证截图及测量报告保存于本地 `artifacts/landing/` 和 `.impeccable/review/landing/`，不进入 Git。

## Tailwind 桌面样式迁移

2026-10-11 使用现有 Tailwind 4.3.3 将共享工作台与首页样式迁移为 `@apply`，首页通过 `@reference` 引用共享主题。保留语义选择器与组件行为，移除宽度断点及首页基于 matchMedia 的折叠初始化。Landing Page 资产和入口保持原样。此前手机验证属于迁移前版本，当前只支持桌面布局。

## shadcn/ui 页面覆盖

2026-10-12 完成两个入口的组件迁移，共享 Tailwind 4 Modern Slate 令牌。逐页组件清单、保留的业务内容及维护方法见 [shadcn-ui.md](shadcn-ui.md)。上文 2026-10-11 的资产获取与验证属于迁移前记录。
