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

现有页面的文字、背景、表单、状态徽章和弹窗引用主题变量。保留现有布局和 Preflight 策略。状态配色只影响展示，不改变 Project → Campaign → Run 的状态与人工评审契约。

设计资产中的 `init_theme_preset` 与 `npx acceptances theme init` 是原型文案，不是本项目已注册的工具或 CLI 命令，不据此安装依赖或执行命令。
