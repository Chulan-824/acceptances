# Vercel 全站主题迁移验证

日期：2026-10-19。验证对象为当前工作区生产构建，基线 HEAD `59d1b49`。未提交或推送。

## 范围与隔离

覆盖首页、项目管理、Run 工作台与历史轮次、Check Item、Evidence、Review、交付列表、四步交付确认、交付详情、业务说明和 Landing。

真实浏览器使用独立服务 `127.0.0.1:8886`、独立数据目录 `.scratch/vercel-theme/data`。验证创建、人工接受及撤回、说明生成只写入该合成副本；现有 8765 数据未用于写入。合成报告、截图素材与人工判断用于验证平台展示，不构成任何真实业务需求通过的证据。

## 要求与实现

| 要求             | 实现与证据                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 统一视觉规范     | `DESIGN.md` 和 `.impeccable/design.json` 同步黑白基准、字阶、间距、圆角、细边框；登记彩色业务状态、中文字距/行高、三栏密度和历史证据例外 |
| 唯一主题来源     | `apps/web/src/theme.css` 定义最终值，映射 shadcn 语义；保留 Tailwind 默认间距含义，未复制 `--spacing-4:4px`                              |
| 全站调用迁移     | shadcn、ReUI、工作台、交付、Evidence、Landing 的旧颜色/圆角/投影和字阶调用迁移；菜单使用 1px 细环                                        |
| 官方字体自托管   | Vercel 官方页面 Download 指向的 Geist 1.8.1 原始 WOFF2，正常/斜体 Sans/Mono 四文件；来源、摘要和 OFL 在 `apps/web/public/fonts/geist/`   |
| 新版离线业务说明 | `apps/web/offline_theme.go` 编译时嵌入同一份主题、四字体及 OFL；新模板 `business-html-v2-geist`；历史文件保留，未改写冻结证据            |
| 真实页面与状态   | 下列浏览器矩阵、计算样式、平台实际字体、截图及操作证据                                                                                   |

## 浏览器矩阵

| 页面或交互           | 窗口/覆盖                                                               | 结果                                                                         |
| -------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 首页                 | 1440、390；长中文名称和说明；卡片/统计/筛选/表单                        | passed                                                                       |
| 项目管理             | 1440；名称、说明、关联与需求面板                                        | passed                                                                       |
| Run 工作台           | 1120、1440、1920；约 195 字中英混排标题                                 | passed，1120 时中心栏 480px                                                  |
| 历史 Run             | 1440；历史人工与交付状态                                                | passed                                                                       |
| 交付列表、详情、确认 | 各 1440、390                                                            | passed                                                                       |
| Landing              | 1440、390；全页、页签、复制、图片放大                                   | passed；首轮问题修正后，390px 三个页签与放大入口可点击，CLI 与对比表为中性色 |
| 表单与按钮           | 默认、hover、键盘焦点、必填错误、创建中禁用、选中筛选                   | passed                                                                       |
| Check Item           | 原始失败与人工通过同时显示，随后撤回待审                                | passed，仅操作合成副本                                                       |
| Review               | 未填理由的确认按钮禁用；批量弹窗 1440、390；Esc 关闭                    | passed                                                                       |
| Evidence             | Markdown 中英混排/斜体/代码，CSV 表格，Patch 差异，图片 150% 缩放与 Esc | passed                                                                       |
| 四步交付             | 上一步禁用、范围/素材/敏感信息确认、接受理由、最终按钮门禁              | passed，未提交新的交付快照                                                   |
| 业务说明             | 新版生成及预览 1440、390；390 离线独立 HTML                             | passed，无横向溢出、无外部请求                                               |

15 个页面/视口组合的计算样式检查，以及九组交互检查均无断言失败、浏览器运行时错误或 console error。页面根节点无溢出不能证明内部控件没有裁剪，故独立复审另检查完整截图和手机控件可见性。

## 实际样式与字体

- Canvas `rgb(250,250,250)`、主文字 `rgb(23,23,23)`；首页卡片白底、6px 圆角、16px 内边距、无投影。
- 主操作背景从 `#171717` 悬停到 `#4d4d4d`；键盘焦点为 2px 实线；输入错误使用 `#be123c`。密集操作 13px 是已登记的 caption 例外。
- Review 白底、6px 圆角、`#ebebeb` 边框，无模糊投影；390px 弹窗可容纳。截图禁用入场动画后重拍，计算 opacity 为 1。
- Select 菜单为白底、6px 圆角、`#ebebeb` 的 1px 零模糊细环。
- Chrome `CSS.getPlatformFontsForNode` 对混排标题返回 Geist 自定义字体 147 个 glyph、PingFang SC 30 个 glyph，证明实际使用网络字体及中文系统回退。
- 四个字体均通过浏览器字体加载；正常页面只请求本机 `/fonts/geist/` 资源。离线 HTML 内嵌四个 `data:font/woff2` 与完整 OFL，断网仍加载 Sans/Mono，正文 16px/24px。

## 检查与证据位置

`make lint typecheck build test` 已通过，包括 Prettier、ESLint、Go vet、TypeScript、生产构建及全部 Go 测试。后续菜单与 Landing 修正后按范围重新执行 lint、类型检查和构建。`git diff --check` 通过。

构建仍提示部分语法高亮代码块大于 500KB，这是现有依赖拆包提示，本次未扩大到构建性能优化。

本机验证材料保存在被忽略的 `.scratch/vercel-theme/`：

- `final-checks.log`：完整检查与 Go 测试；`reviewer-fixes-checks.log`：最终修正检查。
- `final-page-measurements.json`：15 个页面/视口的计算值、平台字体与资源。
- `interaction-measurements.json`：九组交互的实测值。
- `offline-document-measurements.json`：新版说明的断网、字体、许可和窗口检查。
- `font-menu-measurements.json`：四字体加载及菜单细环。
- `landing-fix-measurements.json`：390px 三页签的可见边界、选中状态、放大操作及营销区域中性色。
- `check-item-measurements.json`：原始失败与人工通过分别展示，撤回后恢复待审。
- `verify-pages.cjs`、`verify-interactions.cjs`：真实浏览器复验脚本，固定连接隔离服务。
- `output/playwright/after-*.png` 与 `state-*.png`：页面及状态截图。`before-*` 为迁移前风格参考，数据不同，不能用于逐像素回归判断。
- `design-review.md`：独立初轮审查、F1/F2 修复复核及其验收边界。
- `detector.json`：四条 Geist 常用字体提醒，按用户指定风格保留，没有其他扫描发现。

文档复核已将主题令牌、完整字体回退栈、状态色例外及离线模板与源码对齐。sidecar 使用 schemaVersion 2，补全六种按钮变体、输入、导航、状态徽章和面板的十组独立预览；色阶只供面板展示，不新增运行时颜色。DESIGN 与 sidecar 的叙述逐字对应。独立设计复审初轮发现 F1 手机产品图控件裁剪和 F2 营销区域误用业务状态色，两项均已修复；最终 verdict 为 ship，仅针对 F1/F2 修复复核，未开启新的缺陷搜索。主体主题初轮未发现其他 material 问题，详见本机 `design-review.md`。文档复核未发现实现与规范的 material 差异。未执行跨浏览器、实体移动设备或辅助技术专项验收；工作台按既有产品约束以 1120px 为最小窗口，手机验证覆盖首页、交付、弹窗、离线说明和 Landing。
