---
name: Acceptances · Vercel
description: 黑白中性、细边框、Geist 字体的验收工作台；彩色仅表达业务状态
colors:
  canvas: "#fafafa"
  surface: "#ffffff"
  surface-subtle: "#fafafa"
  surface-hover: "#ebebeb"
  fg: "#171717"
  fg-secondary: "#4d4d4d"
  fg-muted: "#666666"
  muted: "#666666"
  fg-subtle: "#7d7d7d"
  border: "#ebebeb"
  border-dark: "#c9c9c9"
  brand: "#171717"
  brand-hover: "#4d4d4d"
  brand-fg: "#ffffff"
  topnav-bg: "rgb(250 250 250 / 90%)"
  disabled: "#c9c9c9"
  success: "#059669"
  success-soft: "#ecfdf5"
  success-border: "#a7f3d0"
  success-dark: "#047857"
  warning: "#d97706"
  warning-soft: "#fffbeb"
  warning-border: "#fde68a"
  warning-dark: "#b45309"
  danger: "#e11d48"
  danger-soft: "#fff1f2"
  danger-border: "#fecdd3"
  danger-dark: "#be123c"
typography:
  display:
    fontFamily: "Geist Sans, PingFang SC, Hiragino Sans GB, Microsoft YaHei, ui-sans-serif, system-ui, sans-serif"
    fontSize: 64px
    fontWeight: 450
    lineHeight: 1
    letterSpacing: "-0.06em"
  heading-lg:
    fontFamily: "Geist Sans, PingFang SC, Hiragino Sans GB, Microsoft YaHei, ui-sans-serif, system-ui, sans-serif"
    fontSize: 56px
    fontWeight: 450
    lineHeight: 1
    letterSpacing: "-0.06em"
  heading:
    fontFamily: "Geist Sans, PingFang SC, Hiragino Sans GB, Microsoft YaHei, ui-sans-serif, system-ui, sans-serif"
    fontSize: 30px
    fontWeight: 450
    lineHeight: 1.1
    letterSpacing: "-0.05em"
  body:
    fontFamily: "Geist Sans, PingFang SC, Hiragino Sans GB, Microsoft YaHei, ui-sans-serif, system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  ui:
    fontFamily: "Geist Sans, PingFang SC, Hiragino Sans GB, Microsoft YaHei, ui-sans-serif, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: "normal"
  caption:
    fontFamily: "Geist Sans, PingFang SC, Hiragino Sans GB, Microsoft YaHei, ui-sans-serif, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.54
    letterSpacing: "normal"
  meta:
    fontFamily: "Geist Sans, PingFang SC, Hiragino Sans GB, Microsoft YaHei, ui-sans-serif, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  mono:
    fontFamily: "Geist Mono, PingFang SC, Microsoft YaHei, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  eyebrow:
    fontFamily: "Geist Mono, PingFang SC, Microsoft YaHei, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.071em"
rounded:
  nav: 2px
  default: 6px
  pill: 9999px
spacing:
  "4": 4px
  "6": 6px
  "8": 8px
  "12": 12px
  "14": 14px
  "16": 16px
  "20": 20px
  "24": 24px
  "32": 32px
  "40": 40px
  "44": 44px
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-fg}"
    rounded: "{rounded.default}"
    padding: "8px 12px"
    typography: "{typography.ui}"
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
  button-secondary:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.fg-secondary}"
    rounded: "{rounded.default}"
    padding: "8px 12px"
    typography: "{typography.ui}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg-secondary}"
    rounded: "{rounded.default}"
    padding: "8px 12px"
    typography: "{typography.ui}"
  button-destructive:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger-dark}"
    rounded: "{rounded.default}"
    padding: "8px 12px"
    typography: "{typography.ui}"
  button-ghost:
    textColor: "{colors.fg-secondary}"
    rounded: "{rounded.default}"
    padding: "8px 12px"
    typography: "{typography.ui}"
  button-link:
    textColor: "{colors.fg-secondary}"
    rounded: "{rounded.default}"
    padding: "8px 12px"
    typography: "{typography.ui}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.default}"
    padding: "8px 12px"
    typography: "{typography.ui}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.default}"
    padding: "16px"
  badge:
    backgroundColor: "{colors.surface-subtle}"
    rounded: "{rounded.default}"
    padding: "4px 8px"
    typography: "{typography.caption}"
  badge-passed:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success-dark}"
  badge-blocked:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning-dark}"
  badge-failed:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger-dark}"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.default}"
    padding: "24px"
---

# Design System: Acceptances · Vercel

## Overview

**Creative North Star: "黑白清晰的验收工作台"**

2026-10-19 按用户授权，将全站 Modern Slate 替换为 Refero 的 Vercel 浅色视觉基准。产品功能与人工判断规则以 PRODUCT.md 和 GLOSSARY.md 为准。

视觉采用中性黑白、Geist Sans / Mono、6px 轻圆角与细边框。规范覆盖首页、项目管理、Run / Check Item、Evidence 预览、Review 弹窗、交付与业务说明，以及 Landing Page。工作台是 Operate，Landing 是 Persuade；共享同一主题，密度和标题尺度按场景应用。

运行时唯一主题来源是 [theme.css](apps/web/src/theme.css)，本文 frontmatter 和 [.impeccable/design.json](.impeccable/design.json) 是它的设计记录。shadcn 源码由 ui.css 提供基础状态，ReUI 组合布局由 reui.css 提供，页面局部样式只负责布局、密度和明确的上下文状态。

参考来源是 [Refero Vercel](https://styles.refero.design/style/f24daf3a-d43f-4dec-85a9-8ac1d5148a03)，其中测量经过归一化，规则经过解释，并非 Vercel 官方组件源码。字体由 [Vercel 官方字体页](https://vercel.com/font) 的 Download 进入官方 GitHub 发布下载，固定 1.8.1，来源、文件摘要及 OFL 见 [字体来源](apps/web/public/fonts/geist/SOURCE.md)。

**Key Characteristics:**

- Geist Sans / Mono 本地加载并保留中文回退
- 细边框分区，无模糊投影
- 工作台紧凑，Landing 留白采用 96 / 128px
- 业务状态始终带文字

## Colors

| 角色                  | 主题名称                   | 值      | shadcn 映射                 |
| --------------------- | -------------------------- | ------- | --------------------------- |
| 页面画布              | canvas                     | #fafafa | background                  |
| 内容表面              | surface                    | #ffffff | card / popover              |
| 次级表面              | surface-subtle             | #fafafa | secondary / 原始 --muted    |
| 悬停、按下表面        | surface-hover              | #ebebeb | accent                      |
| 主文字、主操作、焦点  | fg / brand                 | #171717 | foreground / primary / ring |
| 次文字、主按钮悬停    | fg-secondary / brand-hover | #4d4d4d | secondary-foreground        |
| 辅助文字、placeholder | muted / fg-muted           | #666666 | muted-foreground            |
| 第三级非必要图形      | fg-subtle                  | #7d7d7d | 无                          |
| 细边框                | border                     | #ebebeb | border                      |
| 控件边框、滚动条      | border-dark                | #c9c9c9 | input                       |

白色主按钮文字使用 brand-fg。灰色的禁用文字样本 disabled=#c9c9c9 只用于禁用或非必要图形；可操作控件和正文不得使用它。禁用控件保留原变体并以 0.5 透明度和禁用交互表示，不新增颜色。

业务状态色是黑白视觉的明确例外，保留原有含义与配色：success 的深色/浅底/边框为 #047857 / #ecfdf5 / #a7f3d0；warning 为 #b45309 / #fffbeb / #fde68a；danger 为 #be123c / #fff1f2 / #fecdd3。passed、accepted 使用 success，pending、blocked 使用 warning，failed、rejected、void 使用 danger。skipped 和 comment 保持中性。状态始终有文字，必要时配合图标，颜色不替代状态含义。

业务成功色从旧 accent 改名为 success；shadcn accent 现在是中性悬停表面。应用原有 text-muted 仍表示文字灰，原始 shadcn --muted 表示表面，两者在主题中明确映射。禁止把状态色用于普通导航、链接或装饰。Landing 静态产品示例中的结果标签可以使用状态色，装饰圆点保持中性。

**The 状态色例外 Rule.** success、warning、danger 只表达真实业务状态，accent 表示中性悬停表面。

## Typography

Geist Sans 用于正文、标题与控件；Geist Mono 用于版本、标识、代码、日志和数字。正常体与斜体均由本地可变 WOFF2、@font-face 100–900 和 font-display:swap 加载，两个入口预加载正常体。无需第三方字体请求或本机安装字体。中文回退 PingFang SC / Hiragino Sans GB / Microsoft YaHei，系统 sans-serif 兜底。

| 角色        | 字号 | 字重 | 行高 | 字距    | 用法                             |
| ----------- | ---- | ---- | ---- | ------- | -------------------------------- |
| display     | 64px | 450  | 1    | -0.06em | Landing 大屏英文展示标题         |
| heading-lg  | 56px | 450  | 1    | -0.06em | Landing 中屏英文展示标题         |
| heading     | 30px | 450  | 1.1  | -0.05em | 页面标题、Landing 章节标题       |
| body        | 16px | 400  | 1.5  | normal  | 报告正文、长段落                 |
| ui          | 14px | 400  | 1.43 | normal  | 操作、导航、表单、工作台文字     |
| caption     | 13px | 400  | 1.54 | normal  | 徽章、辅助说明                   |
| meta / mono | 12px | 400  | 1.5  | normal  | 元数据、计数、代码和日志         |
| eyebrow     | 11px | 400  | 1.5  | 0.071em | 仅英文等宽短标记，不用于中文信息 |

中文可读性是明确例外：中文与中英混排标题字距 normal，工作台标题行高 1.5，Landing 展示标题行高 1.1；中文正文与报告行高 1.5。中文标签不使用 8px 或强制 uppercase，最小 12px。标题不使用旧 600–800 粗黑，层级以 450 标题和 400 / 500 文本表达。正文最大阅读宽度 75ch。代码使用等宽字体，不将所有中文标签设为等宽。

**The 中文排版例外 Rule.** 中文标题字距 normal，工作台标题行高 1.5，Landing 展示标题行高 1.1。

## Layout

间距采用参考的 4 / 6 / 8 / 12 / 14 / 16 / 20 / 24 / 32 / 40 / 44px。2px 用于紧凑徽章、图标和分隔线微调，0px 用于平面分区。布局几何、媒体宽高、滚动余量和可访问热区不当作装饰间距重新缩放。

Tailwind 保留默认 --spacing=0.25rem。4px 使用 p-1 / gap-1，16px 使用 p-4 / gap-4，绝不导入 Refero 的 --spacing-4:4px 覆盖数值工具类。需要精确 14px 时使用 p-[14px] 或现有 p-3.5。

工作台保留桌面三栏、独立滚动、用户可调侧栏和 1120px 最小宽度，较窄窗口横向访问，不压缩检查项和人工判断。报告最大宽度 896px，正文最大 75ch；普通面板内边距 16px，工具栏与分组间距 12px，区域分隔 24 / 32px。首页、项目管理外壳、交付页和弹窗可在窄屏换行。

Landing 容器最大 1280px，横向边距 24px，章节上下内边距各 48px、大屏各 64px，使连续内容区间形成 96 / 128px 间隔。卡片内边距 16px，网格间隔 16 / 24px；导航 64px，锚点偏移 80px。390px 验证窗口为单列，标题 30px；在 640px 和 1024px 断点分别切换为 56px 和 64px。保留真实导航、截图切换、复制与放大，不新增品牌标记或商业主张。

## Elevation & Depth

以 1px 细边框组织表面。常规卡片、ReUI 面板和固定评审栏无投影。参考的 subtle 双环是 0 0 0 1px rgb(0 0 0 / 8%), 0 0 0 2px #fafafa；单环为 0 0 0 1px #ebebeb。下拉、tooltip 使用主题细环，不引入旧 Slate 模糊阴影。选中标签用中性底和细环，报告标签用底部线。

弹窗以遮罩、固定层级与白色表面区分。图片预览可使用 #171717 反色覆盖层，控制按钮白字并保留可见焦点。禁用态 0.5 透明度，焦点为 #171717 的 2px 轮廓、3px 偏移；反色表面使用白色轮廓。已有微动效保持短时 80–180ms，并支持 prefers-reduced-motion，不把动画作为进入内容的门槛。

## Shapes

所有矩形按钮、输入框、卡片、弹窗和 ReUI 面板使用 6px。nav 小轮廓使用 2px，圆形状态点、步骤序号、图标圆钮与 pill 使用 9999px。保留三栏平面分区的 0px 圆角。旧 md / lg / xl / 2xl 只作为 6px 兼容别名，现有调用统一迁移为 rounded-default。

## Components

- Button：默认 14px 常规字重；首页创建、工具栏与工作台密集操作可使用 caption 13px，默认水平 12px、垂直 8px，6px 圆角；主按钮深底白字，悬停 #4d4d4d，次按钮悬停 #ebebeb。危险操作使用明确的 danger 例外。选中、hover、focus-visible、disabled 分别表达。
- Input / Textarea / Select：白底、#c9c9c9 边框、#666666 placeholder。错误用 danger 边框与文字，错误焦点保持可见；中文表单保留至少 44px 的主要输入高度。禁用与保存中保留字段内容和真实门禁。
- Badge / Timeline / Stepper：文字表达状态，12–14px；业务成功与交互 accent 分开。状态点或时间线位置不能推断业务接受。步骤切换不代替最终确认。
- Card / Frame：白底、细边框、6px 圆角；内容面板 16px 内边距。flat / ghost 继续承担工作台平面布局，不因为使用 Slot 而失去样式。
- Check Item：分隔线、可展开摘要、原始结果与人工状态分别呈现；搜索筛选不改变批量判断范围。证据、草稿、历史和理由门禁保持现有行为。
- Evidence：预览外壳共享字体和主题，代码、Markdown、CSV 和差异外围使用统一类型尺度。差异内部的语法与增删颜色属于内容语义例外。图片、视频、历史截图与已经冻结的离线业务说明属于不可变证据，不重新着色或改写。
- Dialog / Review / Business Documents：白色内容表面、6px 圆角、24px 内边距；长内容滚动，Esc、关闭、焦点圈定与恢复保留。业务说明预览的外壳统一主题，新生成的离线说明从同一 theme.css 内嵌主题和四个 Geist 字体及 OFL 许可证，使用 business-html-v2-geist 模板；预览与独立 HTML 的 CSP 允许 data: 字体。历史独立文档保留生成版本自带样式。
- Tabs / 菜单：普通悬停与键盘高亮用中性色，选中以文字与线框表达；保留 aria-current / aria-pressed / data-state 和键盘操作。Toast 也使用同一字体、表面、边框和圆角。

## Do's and Don'ts

### Do

- 使用 theme.css 的语义变量，不在页面重新声明颜色、字体或装饰阴影。
- 中文正文、长标题、未知状态和失败信息必须可读；换行或滚动不隐藏必要信息。
- 新组件遵循现有语义映射；shadcn new-york 和 baseColor 是生成配置，不是运行时换肤开关。
- 保留通过、阻塞、失败等业务状态文字及色彩例外，不把黑白主题理解为去掉判断信息。

### Don't

- 不复制 Vercel 三角标、商标或客户背书，不将 Refero 导出当成官方源码。
- 不覆写 Tailwind 数值间距，不恢复大圆角和模糊投影，不将历史截图和离线文档当作当前页面主题证据。

真实计算样式、字体加载与页面截图验证见 [验证记录](docs/vercel-theme-verification.md)；构建通过不代替页面验收。
