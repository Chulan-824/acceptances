# ReUI 页面组合层

2026-10-15，Web 的两个入口采用 shadcn/ui 基础控件和 ReUI 组合组件，继续使用 Modern Slate。ReUI 组件实际保存在 `apps/web/src/components/reui/`，不通过重新导出 shadcn 组件冒充接入。

## 来源与维护

- 官方 [registry](https://reui.io/docs/registry) 的 `radix-nova` 免费组件源码，包括 Frame、Timeline、Stepper、File Type、Scrollspy、Alert 和 Badge。来源 URL 与下载内容的 SHA-256 见 [upstream.json](../apps/web/src/components/reui/upstream.json)。该摘要标识下载的 registry JSON，不是修改后文件的校验值。
- 表单 `FormField` 与 `EmptyState` 根据官方免费 `c-field-2`、`c-empty-1` 示例改编；它们组合 shadcn Field、Empty 等基础控件。它们是项目适配的组合，不是名为 FormField、EmptyState 的 ReUI 原生组件。
- 新增的 shadcn Field、Empty 来源为官方 `new-york-v4` registry，仍放在 `components/ui/`。原有 Button、Input、Select、Dialog、Tabs、Collapsible、Resizable 等基础组件继续复用。
- ReUI 免费源码的 [MIT 许可](../apps/web/src/components/reui/LICENSE.md) 随代码保留。本次未使用付费 Blocks、模板或付费图标。
- `components.json` 的 `@reui` 固定到 `radix-nova` registry；现有 shadcn `new-york` 配置保持。不要将 `@reui` 当作 npm 包安装，也不要批量覆盖已定制的 `components/ui/`。
- 上游当前的 `cn` 包导入改为项目已有 `@/lib/utils`，不增加重复的类名合并依赖。

## 页面覆盖

| 页面或区域                                                   | 入口与文件                                                     | 实际组合                                                                                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 首页 `/`                                                     | `home.tsx`、`home-create.tsx`                                  | Frame 管理看板纵向布局，Header/Footer 组合筛选与版本操作；FramePanel 统一统计、侧栏与需求卡片外观；FormField、EmptyState、Alert   |
| 项目 `/projects/:pid`                                        | `project.tsx`                                                  | Frame + FrameHeader + flat FramePanel 组合项目标题操作与代码来源内容；EmptyState 导航空状态                                       |
| 需求默认入口 `/projects/:pid/campaigns/:cid`                 | `campaign.tsx`、`campaign-delivery.tsx`                        | flat FramePanel 保留平面需求分区，outline FramePanel + Header 组合交付概览，Timeline 展示运行记录                                 |
| 显式当前、历史 Run `/projects/:pid/campaigns/:cid/runs/:rid` | `run.tsx`、`checklist.tsx`、`review.tsx`                       | ghost Frame + Header 管理检查区与筛选，subtle FramePanel 展示摘要，FormField 评审理由与评论，Timeline 人审历史，EmptyState、Alert |
| 文件及内联证据                                               | `evidence.tsx`、`text-evidence.tsx`                            | outline FramePanel 提供证据边框与圆角，图库保留 12px 内边距；File Type 非图片文件标识，Alert 读取异常；媒体与文本预览复用既有能力 |
| 交付列表 `/deliveries`                                       | `delivery-archive.tsx`                                         | Frame 筛选工具栏，FramePanel 版本列表，EmptyState 区分无交付与无结果                                                              |
| 冻结确认 `/deliveries/new/:rid`                              | `freeze-delivery.tsx`                                          | Frame、Stepper 四步确认、FramePanel 内容区、FrameFooter 操作区                                                                    |
| 交付详情 `/deliveries/:did`                                  | `delivery-detail.tsx`、`business-documents.tsx`                | Frame + Header 组合说明区，divider FramePanel 管理各说明版本的间距与分隔线；Timeline 交付效力记录，EmptyState、Alert、Badge       |
| 产品介绍 `/landing.html`                                     | `landing/main.tsx`                                             | FramePanel 展示、特性及规范区块，Scrollspy 分区高亮；原生锚点负责导航；ReUI Badge，shadcn Tabs、Dialog、Table、Sonner             |
| 共享状态与批量确认                                           | `client.tsx`、`check-counts.tsx`、`bulk-acceptance-dialog.tsx` | ReUI Badge 与 Alert，保留 shadcn AlertDialog、Dialog 的焦点与确认机制                                                             |

保留原生标题、链接、段落、定义列表、表单提交、复选框、媒体元素与 sandbox iframe。这些元素表达内容或浏览器能力，不为覆盖清单额外套控件。覆盖以正常有数据页面的实际布局、主题样式和交互职责为依据，不以导入、data-slot 或组件数量为依据。基础控件仍由 shadcn/ui 提供。

## 本地适配

- `theme.css` 令牌保持原值；`reui.css` 只处理组合布局。通用中性背景使用 `surface-subtle`，不用表示文字灰的 `muted` 或表示接受绿的 `accent`。Badge 默认保留原有状态类、无边框、400 字重和密度；Alert 的默认圆角与内边距沿用已有 ui-alert。
- Frame 保留 ReUI 的 Frame/Header/Panel/Footer 结构、父级间距变量、stacked 相邻面板与 dense 布局。样式迁入 `reui.css` 的 components 层，以现有令牌适配；这是本地适配版本，不是未经修改的上游源码。`asChild` 只切换宿主元素，所有组合样式与变体同样生效。
- `ghost` Frame 配合 `spacing="none"` 管理工作台的平面内容流；项目设置使用 Header 和 flat Panel 分离标题操作及内容。默认 FramePanel 使用既有 12px 圆角和 `shadow-subtle`，恢复交付列表原有外观。`flat` 用于无卡片装饰的分区，`subtle` 用于摘要，`outline` 用于交付准备与证据，`divider` 用于说明版本列表。
- 首页统计、侧栏、需求卡片的公共背景、边框、圆角和阴影已从页面 CSS 移至 FramePanel；摘要外观、说明版本分隔线也由对应变体负责。页面 CSS 只保留业务布局、密度和必要的上下文覆盖。不要再按 `asChild` 关闭组件样式。
- Timeline 历史项按内容高度排列，取消上游 `flex-1` 的均分拉伸。历史不使用位置推断业务通过状态，真实状态仍由文字 Badge 表达。反馈锚点和后续 Run 链接保留。
- Stepper 使用实例唯一 ID、正确关联的 tablist/tabpanel、隐藏但保留的步骤内容和跳过禁用按钮的键盘导航；地图与素材步骤由明确勾选决定完成状态。分步浏览不自动勾选确认。
- Scrollspy 的监听器正确清理。页面级锚点不调用 preventDefault，由浏览器负责 hash、前进后退、键盘激活、修饰键与新标签页；只根据滚动更新高亮和 aria-current。仅自定义滚动容器的普通主键点击使用程序滚动，放行修饰键、其他按钮、download 和非当前目标。
- Landing 的固定导航偏移使用 `scroll-margin-top: 80px`，平滑滚动使用 CSS，并支持 reduced motion。显式点击产生原生历史记录，被动滚动不改写 URL。

## 交互与业务边界

检查清单可以组合关键词、原始结果和人工状态。筛选不会改变底部汇总或批量通过的全量范围。草稿保存在当前 Checklist，切换筛选、折叠和 Tabs 后保留；离开当前 Run 或刷新页面不承诺保留。深链接定位同时清除原始结果与人工状态筛选。

冻结确认分为代码构建、地图范围、说明素材和最终确认。地图、素材、敏感信息三个明确确认与例外理由仍是最终提交条件；后端 preparation 的 eligible、token 和请求幂等规则不变。回到前面步骤可以撤回勾选，最终操作随之禁用；结果未知时锁定输入和步骤导航，重试使用完全相同的提交内容与 requestId。

最新 Run、本轮人工判断、有效冻结版本和业务说明分别展示。切换历史 Run 不改变 Campaign 交付概览，新的待审 Run 不抹除旧有效交付。没有修改 API、数据库和领域判断规则。

## 本轮修复与验证

2026-10-15 的审查指出 Slot 空包装、交付卡片主题偏移和 Landing 原生导航丢失。本轮已修复这三项。以下是修复后的验证，不能与首次迁移的历史记录混用。

- `make lint typecheck build`、`make test`、`git diff --check` 通过；前端 controller 与 delivery model 的 35 项测试通过。
- 真实浏览器覆盖首页、项目设置、默认需求入口、显式当前与历史 Run、交付列表、冻结确认、交付详情、Landing 共 9 个页面状态。1440px 均无页面横向溢出，正常访问未捕获页面异常或控制台错误。工作台另检查 1120px 中栏至少 480px、1920px 评审栏；首页、冻结、Landing 检查 390px。
- 与同一 `HEAD` 基线的运行页面对比代表区域的背景、文字色、边框、圆角、内边距、有效阴影、字号和字重，无差异。比较覆盖统计、侧栏、工具栏、需求卡片、工作台分区、交付概览、摘要、证据、业务说明与版本项、交付卡片、状态标签；不代表逐像素或全部状态视觉验收。零透明阴影归一化后比较。
- 对共享样式做浏览器内的临时移除再恢复：统计面板边框为 1px，移除 FramePanel 规则后变为 0，恢复后回到 1px。结合页面 CSS 去重与实际 flex 布局，确认组合层有实际职责，未把 DOM 标记数量当作覆盖证据。
- 原生导航验证通过：显式点击写入 hash，前进与后退恢复对应分区，键盘 Enter 激活，平台修饰键实际打开新标签页；Cmd/Ctrl/Shift/Alt 和其他按钮不被 Scrollspy 拦截。被动滚动不改写 URL，固定导航偏移为 80px，减弱动画模式有效。
- 只读浏览器回归通过：字段校验、筛选与重置、评审草稿保留、深链接展开、筛选后批量弹窗仍展示全部 19 项、图片与文本证据、说明预览 sandbox 和焦点恢复、四步确认与撤回勾选。
- 独立 8879 API 与空数据库真实执行：逐项接受与拒绝理由门槛、评审落库、筛选后全量批量通过、原始失败及历史保留、整轮评论、四步冻结、业务说明生成与离线 HTML。
- 冻结首次实际保存返回 201 后，测试故意丢弃响应。界面进入结果未知并锁定理由和步骤；重试完整 payload 与 requestId 相同，实际 API 返回 200，同 Campaign 仅产生一份快照。
- 独立 API 验证新待审 Run 保留旧有效交付、切换历史 Run 不改变需求交付权威源、撤回来源评审使交付失效且摘要不变、重新通过不恢复效力、失效禁止新生成但保留历史说明预览。

浏览器脚本与具体夹具 ID 记录在本机 `.scratch/reui/`，独立数据库为 `.scratch/reui/fix-data.NHuPd0`，截图为 `.playwright-mcp/reui-fixed-*.png`。这些忽略目录不保证存在于其他 checkout；测试数据是合成夹具，不代表业务需求已获人工接受。既有 8765 数据只读，未提交 Git 变更。
