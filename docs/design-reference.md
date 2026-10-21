# Acceptances 设计来源与主题接入

2026-10-19 全站主题由 Modern Slate 迁移为 Refero Vercel。旧 OpenDesign 项目与页面是布局及文案的历史来源，现行颜色、字体、字号、圆角、边框、阴影与间距以 [DESIGN.md](../DESIGN.md) 和 [theme.css](../apps/web/src/theme.css) 为准。

## 当前视觉来源

- 参考：https://styles.refero.design/style/f24daf3a-d43f-4dec-85a9-8ac1d5148a03 。使用其 DESIGN.md、Tailwind v4、Typography、Fonts、Spacing & Shape 的视觉数值，保留来源上下文。
- 字体：https://vercel.com/font 的官方 Download 链接，固定 Geist 1.8.1，原始 WOFF2 与 OFL 同包提供。[文件、下载地址和摘要](../apps/web/public/fonts/geist/SOURCE.md)。
- 彩色业务状态、中文行高/字距、三栏密度、证据及历史冻结文档内容是明确例外，详见设计规范。

## 唯一主题入口

工作台 style.css 与 Landing landing.css 均加载 theme.css、ui.css、reui.css。theme.css 负责最终令牌与 @font-face，ui.css 负责基础控件状态，reui.css 负责组合布局，页面负责密度与结构。fg→foreground，brand→primary，surface→card/popover，canvas→background，surface-hover→accent。业务成功色改为 success，避免与 shadcn accent 混用。

保留 Tailwind 4 默认数值间距；禁止复制 --spacing-4:4px。6px 矩形圆角统一为 rounded-default；实际布局尺寸、证据比例与滚动几何保留。新生成的离线业务说明通过 apps/web/offline_theme.go 嵌入同一份 theme.css、四个原始字体及 OFL 许可证，不依赖服务或外部字体网络。模板升级为 business-html-v2-geist，历史已生成文件保持字节不变。

shadcn 配置继续使用现有 new-york 与 Lucide，运行时外观由 CSS 令牌决定。

## 保留的产品布局与来源

- OpenDesign 历史项目 ID：43956615-b9b9-4f7a-9712-611dcf46801d，历史主题 Modern Slate 1.0.0。它不再控制当前主题。
- 首页继续展示交付看板、项目筛选与创建；三栏工作台继续独立滚动、侧栏可调，最小 1120px。
- Landing 独立入口 /landing.html，保留既有文案、三张历史产品图、页签、锚点、复制和放大。历史截图不会因主题迁移被重绘。
- 原型里的 theme init、固定外链、示例素材不构成新增能力；产品事实以 PRODUCT.md 和领域文档为准。

覆盖清单见 [shadcn-ui.md](shadcn-ui.md)、[reui.md](reui.md)，本次证据见 [vercel-theme-verification.md](vercel-theme-verification.md)。
