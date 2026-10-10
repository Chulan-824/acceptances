---
name: Acceptances · Modern Slate
description: 围绕需求、证据和人工判断组织信息的验收工作台
colors:
  canvas: "#f8fafc"
  surface: "#ffffff"
  surface-subtle: "#f1f5f9"
  surface-hover: "#f8fafc"
  fg: "#0f172a"
  fg-secondary: "#334155"
  muted: "#64748b"
  border: "#e2e8f0"
  border-dark: "#cbd5e1"
  brand: "#0f172a"
  brand-hover: "#1e293b"
  brand-fg: "#ffffff"
  accent-soft: "#ecfdf5"
  accent-dark: "#047857"
  warning-soft: "#fffbeb"
  warning-dark: "#b45309"
  danger-soft: "#fff1f2"
  danger-border: "#fecdd3"
  danger-dark: "#be123c"
typography:
  headline:
    fontFamily:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft
      YaHei", sans-serif
    fontSize: 22px
    fontWeight: 700
  title:
    fontFamily:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft
      YaHei", sans-serif
    fontSize: 20px
    fontWeight: 700
  sidebar-title:
    fontFamily:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft
      YaHei", sans-serif
    fontSize: 16px
    fontWeight: 700
  subtitle:
    fontFamily:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft
      YaHei", sans-serif
    fontSize: 15px
    fontWeight: 700
  check-title:
    fontFamily:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft
      YaHei", sans-serif
    fontSize: 15px
    fontWeight: 600
  body:
    fontFamily:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft
      YaHei", sans-serif
    fontSize: 16px
    fontWeight: 400
  prose:
    fontFamily:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft
      YaHei", sans-serif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.7
  muted:
    fontFamily:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft
      YaHei", sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft
      YaHei", sans-serif
    fontSize: 13px
    fontWeight: 400
  caption:
    fontFamily:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft
      YaHei", sans-serif
    fontSize: 12px
    fontWeight: 400
  eyebrow:
    fontFamily:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft
      YaHei", sans-serif
    fontSize: 12px
    fontWeight: 400
    letterSpacing: 0.13em
  mono:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
    fontSize: 12px
    lineHeight: 1.7
rounded:
  sm: 4px
  default: 6px
  md: 8px
  lg: 12px
spacing:
  "4": 4px
  "6": 6px
  "8": 8px
  "10": 10px
  "12": 12px
  "16": 16px
  "20": 20px
  "24": 24px
  "28": 28px
components:
  button-default:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.fg-secondary}"
    rounded: "{rounded.default}"
    padding: 10px 16px
    typography: "{typography.body}"
  button-default-hover:
    backgroundColor: "{colors.surface-hover}"
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-fg}"
    rounded: "{rounded.default}"
    padding: 10px 16px
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
  button-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger-dark}"
    rounded: "{rounded.default}"
    padding: 10px 16px
    typography: "{typography.body}"
  button-danger-hover:
    backgroundColor: "{colors.surface-hover}"
  input-search:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.default}"
    padding: 10px
    typography: "{typography.label}"
  filter-chip:
    backgroundColor: transparent
    textColor: "{colors.fg-secondary}"
    rounded: "{rounded.default}"
    padding: 6px 8px
    typography: "{typography.caption}"
  filter-chip-selected:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-fg}"
  filter-chip-selected-hover:
    backgroundColor: "{colors.brand-hover}"
  status-badge:
    backgroundColor: "{colors.surface-subtle}"
    rounded: "{rounded.sm}"
    padding: 4px 9px
    typography: "{typography.label}"
  status-badge-passed:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-dark}"
  status-badge-blocked:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning-dark}"
  status-badge-failed:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger-dark}"
  project-card:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.fg-secondary}"
    rounded: "{rounded.default}"
    padding: 20px
    typography: "{typography.body}"
  navigation-item:
    backgroundColor: transparent
    textColor: "{colors.fg-secondary}"
    rounded: "{rounded.default}"
    padding: 12px
    typography: "{typography.label}"
  navigation-item-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
  report-metrics:
    backgroundColor: "{colors.surface-subtle}"
    rounded: "{rounded.md}"
    padding: 16px
  review-bar:
    backgroundColor: "{colors.surface}"
    padding: 12px 24px
    typography: "{typography.label}"
  section-container:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: 24px
  review-dialog:
    rounded: "{rounded.lg}"
    padding: 24px
---

# Design System: Acceptances

## Overview

**Creative North Star: "验收工作台"**

Acceptances 的现有视觉系统是克制、清晰、偏紧凑的验收工作台。需求导航、报告内容和运行历史通过空间分区与文字层级组织，颜色帮助用户辨认状态，装饰较少。

品牌与主要文字使用深石板灰，冷白与浅石板灰构成画布和内容表面。组件保持克制、明确、轻圆角。主体依靠底色和分隔线建立层次，首页容器、固定评审栏与弹窗使用阴影表达容器和覆盖关系。

本文件记录现有实现，供整个仓库共享。定性描述于 2026-10-10 经用户确认。视觉实现来源为 [style.css](apps/web/src/style.css)，来源对应关系见 [设计参考](docs/design-reference.md)，产品范围见 [PRODUCT.md](PRODUCT.md)。机器令牌在 frontmatter 中登记，阴影、断点与组件预览扩展在 [.impeccable/design.json](.impeccable/design.json) 中登记。

本次检查了源码与本地桌面、窄屏截图，并在临时 Vite 页面采样首页计算样式。业务 API 未启动，工作台与弹窗细节依据现有源码及历史截图核对；此记录不是新的业务流程验收。未使用的主题令牌不纳入本次规范。

**Key Characteristics:**

- 用中性色组织内容，用带文字的状态色标记结果。
- 工作台主体保持平面分区，阴影用于容器和覆盖层级。
- 系统字体适配中文阅读，等宽字体用于版本标识与日志。
- 窄屏重排信息，保留需求、报告、历史与评审入口。

## Colors

深石板灰承载品牌和主要文字，冷白与浅石板灰承担背景层级，状态色用于结果辨识。保持源码的 token 名称，文字描述不另建颜色标识。

### Primary

- 深石板灰 `brand` 用于主要评审按钮、选中筛选与键盘焦点；`brand-hover` 用于主按钮及选中筛选的悬停，`brand-fg` 用于深色背景上的文字。

### Neutral

- 冷白 `surface` 用于内容区、输入框、顶部导航及评审栏；`canvas` 为浅石板画布，`surface-subtle` 用于次级背景、普通按钮、报告摘要与文本证据；`surface-hover` 用于通用按钮悬停。
- `fg` 是主要文字，`fg-secondary` 用于普通按钮与链接，`muted` 用于辅助说明、时间及占位提示。
- `border` 用于常规分隔和轮廓；`border-dark` 用于控件轮廓、选中导航及固定评审栏边界。

### Semantic states

- 通过绿由 `accent-soft` 与 `accent-dark` 配合，用于 `passed`、`accepted` 及文本选择。
- 警示琥珀由 `warning-soft` 与 `warning-dark` 配合，用于 `pending`、`blocked` 和说明提示。
- 错误玫红由 `danger-soft`、`danger-dark` 和 `danger-border` 配合，用于 `failed`、`rejected`、`void`、错误文字与危险操作。
- `skipped` 和 `comment` 沿用中性徽章，不用通过色暗示完成或接受。

**The Status Meaning Rule.** 状态色与文字标签配合使用。通过和接受使用通过绿，待审和阻塞使用警示琥珀，失败、拒绝和作废使用错误玫红；未执行和补充说明保持中性。

配套 JSON 的八阶色带仅用于设计面板预览，根据当前色值合成，不是应用已注册的状态色阶或可替换的主题令牌。

## Typography

标题、正文和控件使用源码中的系统无衬线字体栈，优先本机系统字体，并包含中文回退。版本标识及文本证据使用系统等宽字体栈，不引入额外下载字体。

### Hierarchy

| frontmatter 角色 | 实际上下文                          |
| ---------------- | ----------------------------------- |
| `headline`       | 应用入口标题及首页章节标题          |
| `title`          | 工作台报告与需求章节标题            |
| `sidebar-title`  | 需求导航与运行历史标题              |
| `subtitle`       | 工作台三级标题                      |
| `check-title`    | 检查项标题                          |
| `body`           | 页面正文与普通控件                  |
| `prose`          | 工作台报告正文，最大阅读宽度为 75ch |
| `muted`          | 辅助说明与元数据                    |
| `label`          | 导航、搜索标签、评审栏及普通徽章    |
| `caption`        | 筛选控件、计数徽章及次级导航说明    |
| `eyebrow`        | 顶部英文产品标识                    |
| `mono`           | 文本证据，版本标识仅复用其字体栈    |

`body` 的字号与常规字重经首页计算样式核对；全局未显式设定正文行高，保留浏览器 `normal`。`prose` 与 `muted` 有显式行高；表格式说明和检查项摘要使用各自的 1.6 行高，不将它们归成统一正文行高。表单标签在首页继承正文大小，搜索标签才使用 `label` 大小。当前层级不构成固定比例的字号尺度。

**The Contextual Type Rule.** 字号按实际上下文记录。应用标题与首页章节标题不同于工作台章节标题，不将通用 h1 的旧默认值套到当前入口。

## Layout

首页采用最大宽度 1120px 的居中容器，外围内边距 24px。项目卡片自适应排列，每列至少 240px，间隔 12px。项目管理表单最大宽度 660px。

工作台宽屏使用三栏网格，左栏 260px、中栏 `minmax(0, 1fr)`、右栏 280px。两侧内边距为 20px 16px，侧栏 sticky 并在视口高度内滚动；正文区域横向内边距 28px，以白色底和竖向边界区别于侧栏。

- 1100px 及以下改为左栏 230px 和弹性正文两栏，运行历史移至正文下方的第二列，取消 sticky。
- 760px 及以下改为需求导航、正文、运行历史的纵向排列，侧栏取消 sticky；需求长列表最大高度 240px，正文横向内边距 16px，顶部导航同步收窄。
- 640px 及以下首页卡片单列，普通 section 内边距降至 18px，说明列表改为单列，操作组中的按钮可弹性分配宽度。
- 761px 及以上且出现固定评审栏时，侧栏最大高度为 `calc(100dvh - 90px)`；窄屏运行历史另留 160px 底部空间。

固定评审栏在页面底部，层级为 30；正文、滚动定位和反馈区域预留 160px。底部内边距包含设备安全区。窄屏评审上下文与操作分别占一行，标题可省略溢出文字。

frontmatter 的 `spacing` 来自重复使用的间距字面量，当前 CSS 未注册命名间距尺度，不解释为严格的 8px 网格。控件、标签和徽章的局部内边距继续以实际组件定义为准。

## Elevation & Depth

主体依靠底色与细边框分层，阴影用于容器和覆盖关系。首页 section 使用 `card`，固定评审栏使用 `elevated`，原生 dialog 使用 `window`。工作台正文 section 显式移除阴影、外边框与圆角，保留底部分隔线。

### Shadow vocabulary

- `card` 提供首页容器的轻层次。
- `elevated` 强调固定操作栏，值与主题中 `dropdown` 的既有别名相同。
- `window` 表达弹窗高于页面；遮罩使用品牌色与透明色的混合，品牌色占 60%。

精确阴影值见配套 JSON 的 `extensions.shadows`。`subtle` 与 `dropdown` 未作为独立实际使用项登记。

**The Surface Depth Rule.** 工作台报告区保持无阴影的分隔线结构。首页容器、固定评审栏和弹窗分别沿用 card、elevated 与 window 层次。

## Shapes

小幅圆角让控件边界明确。徽章使用 `sm`，按钮、输入框和导航项使用 `default`，证据容器及报告摘要使用 `md`，首页容器和弹窗使用 `lg`。各值在 frontmatter 的 `rounded` 中登记。

通用控件轮廓为 1px，正文分隔线沿用相同细度。工作台 section 使用直角平面，徽章使用轻圆角矩形。当前界面没有将圆角 `full` 用作默认组件形状。

## Components

### Buttons

普通按钮使用次级表面、次级文字、较深边框和轻圆角，内边距 10px 16px。悬停切换为 `surface-hover`。主评审按钮采用深石板灰与白字，悬停使用 `brand-hover`。危险按钮采用浅错误底、深错误文字与错误边框，但现有悬停仍沿用通用 `surface-hover`，不补造新的危险悬停色。

顶部导航及紧凑按钮内边距为 7px 10px，字号较小。禁用按钮透明度为 0.5，使用禁止指针。按钮与链接的键盘焦点轮廓为品牌色 3px，偏移 3px；没有另设按下动画。

### Chips and status badges

筛选按钮为轻圆角边框控件，内边距 6px 8px，选中状态通过 `aria-pressed`、深底白字共同表达。普通悬停继承通用表面色，选中悬停使用品牌悬停色。

状态徽章内边距 4px 9px，普通大小使用 `label`，检查计数使用 `caption`。徽章保留状态文字，计数和时间采用等宽数字。静态徽章不补造悬停或按下状态。

### Cards and containers

首页章节容器为白底、细边框、较大圆角，内边距 24px，并使用轻阴影。项目卡片是可点击按钮，次级表面、轻圆角、左对齐，内边距 20px，内部间隔 12px；它不继承 section 的白底与阴影。

报告指标区采用次级表面、细边框、中等圆角和 16px 内边距；指标分为比例 2:1 的两列，最近人工决定另占整行。工作台正文区继续使用分隔线，不套用首页容器样式。

### Inputs and fields

搜索框使用白底、较深的 1px 轮廓和轻圆角，内边距 10px，宽度占满所属区域。输入框、textarea 与 select 继承字体，输入文字颜色仍由浏览器控件默认样式决定；不将页面文字色登记成当前已显式实现的输入文字色。

标签位于控件上方，间隔 7px；textarea 最小高度 85px，可纵向调整。占位文字使用 `muted`，键盘焦点沿用品牌色轮廓。错误信息以可见文字和 `role="alert"` 表达；当前没有已实现的错误边框变体。

### Navigation

需求与运行历史导航项左对齐纵向排布，内边距 12px，内部间隔 8px，列表间隔 6px。默认透明，悬停为次级表面；当前项通过 `aria-current="page"`、白底和较深边框表示。当前项悬停时沿用导航悬停底色，边框仍保留。

顶部项目导航包含返回所有项目与原生 select，布局可换行。长标题和说明允许换行，历史时间使用等宽数字。

### Check items and evidence

检查项使用原生 details/summary 与底部分隔线。摘要上下内边距 16px，检查标题较粗，技术 ID 使用较小等宽文字；窄屏状态与附件数量移到标题下。摘要焦点轮廓为 2px，偏移 3px。通过项默认收起，其他状态默认展开。

内联证据自适应网格最小列宽不超过容器宽度，目标最小列宽为 240px，间隔 12px。图片按比例包含显示，内联预览最大高度 280px；文本证据采用次级表面、等宽字体和滚动容器，最大高度 260px。放大图在原生 dialog 中显示，关闭和 Esc 操作保留。

### Review bar and dialogs

固定评审栏用白底、上边框和覆盖层阴影，把报告状态、标题及操作置于同一条栏中；窄屏分为上下两行。侧边 JSON 的评审栏样本只展示栏体，在预览中不固定到宿主页面底部。

普通 dialog 宽度为 `min(520px, calc(100% - 48px))`；评审 dialog 为 `min(640px, calc(100% - 32px))`，图片 dialog 为 `min(1100px, calc(100% - 32px))`。评审和图片 dialog 最大高度为 `calc(100dvh - 32px)`，内容可滚动；窄屏内边距为 16px。关闭入口明确可见。

当前没有自定义 transition、animation 或运动令牌，配套 JSON 的 motion 列表留空。

## Do's and Don'ts

### Do:

- Do 复用当前语义颜色、轻圆角和系统字体，组件状态沿用同一主题。
- Do 保留文字状态、当前与历史报告提示、计数和选中语义，让颜色之外仍有识别依据。
- Do 保留键盘焦点轮廓、原生 dialog 与 details 的操作方式。
- Do 让长标题、版本标识和日志换行或滚动，固定评审栏为正文与历史列表预留底部空间。
- Do 区分首页容器与工作台平面分区，按实际上下文选择字号、内边距和阴影。

### Don't:

- Don't 将成功、警示和危险色当作普通装饰色，或只用颜色表达状态。
- Don't 给每段工作台报告添加卡片阴影或圆角，改变现有分隔线结构。
- Don't 用统一行高覆盖未显式设置行高的原生控件；报告正文与辅助文字有各自的行高规则。
- Don't 移除可见焦点、关闭与 Esc 操作，或让固定评审栏遮挡最后的内容。
- Don't 把主题中尚未使用的令牌、预览合成色阶或原型文案写成已经接入的应用能力。
