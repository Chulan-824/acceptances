# shadcn/ui 页面覆盖

2026-10-12 将当前前端两个入口中的可替换组件统一迁移到 shadcn/ui，沿用既有 Tailwind 4 Modern Slate 主题。业务接口、人工判断规则和 Project → Campaign → Run 关系保持现有契约。

## 页面清单

| 页面或区域                                            | 实现                                  | 替换组件                                                                                              |
| ----------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 项目首页 `/`                                          | `home.tsx`                            | Button、Card、Collapsible、Input、Textarea、Label、Alert、Spinner                                     |
| 项目管理 `/projects/:id`                              | `project.tsx`、`workspace-panels.tsx` | Select、Button、Input、Textarea、Label、DropdownMenu、Popover、Resizable、Tooltip、AlertDialog、Alert |
| 需求与运行历史 `/projects/:id/campaigns/:id`          | `campaign.tsx`                        | Button、Badge、DropdownMenu、AlertDialog、Resizable、Tooltip                                          |
| 当前与历史 Run `/projects/:id/campaigns/:id/runs/:id` | `run.tsx`                             | Tabs、Collapsible、Button、Badge、Alert、Dialog、AlertDialog、Textarea、Label                         |
| 检查清单、筛选与逐项评审                              | `checklist.tsx`、`review.tsx`         | Collapsible、Select、Input、Textarea、Label、Button、Card、Badge、Alert                               |
| 图片、视频、文本附件                                  | `evidence.tsx`、`text-evidence.tsx`   | Button、Dialog、Collapsible、Alert                                                                    |
| 产品介绍 `/landing.html`                              | `landing/main.tsx`                    | Button、Badge、Card、Tabs、Table、Separator、Dialog、Sonner                                           |
| 状态、数量与删除共用交互                              | `client.tsx`、`check-counts.tsx`      | Badge、Alert、Button、AlertDialog、DropdownMenuItem                                                   |

保留原生表单提交、链接、标题、段落、报告定义列表、代码和媒体元素。这些元素表达业务内容或浏览器文件/媒体能力，没有对应的 shadcn 替换交互。三栏业务导航仍由真实项目、需求和 Run 数据驱动，未引入演示导航模型。`components/ui/` 之外不再直接实现 button、input、select、textarea、details、summary、dialog 或 table 控件，也没有手写弹窗焦点圈定和菜单全局监听器。

## 主题与组件维护

- `apps/web/components.json` 配置官方 `new-york` 风格、Tailwind 4、组件目录及 `@/` 别名。Vite 与 TypeScript 使用同一别名。
- `apps/web/src/components/ui/` 保存官方 [new-york-v4 registry](https://ui.shadcn.com/r/styles/new-york-v4/button.json) 的本地组件源码，按当前主题定制。原始 [MIT 许可证](../apps/web/src/components/ui/LICENSE.md) 随源码保留。
- `apps/web/src/theme.css` 是两个入口共用的令牌来源。原有颜色、字体、圆角、阴影不重复定义另一套主题。
- `apps/web/src/ui.css` 定义组件默认样式与状态，页面样式继续定义实际布局和操作密度。工作台不新增 Preflight；Landing Page 的 `landing-base.css` 仅保留当前元素所需的浏览器重置，工具类由共享 Tailwind 4 生成。旧 CSSOM 快照、重复的基础控件样式、失效选择器和未使用的 FilterBar、Toggle、ToggleGroup 已移除。
- 原有 `accent` 是通过绿、`muted` 是辅助文字灰，普通组件悬停使用 `surface-subtle`，不能套用 shadcn 默认的同名背景语义。
- `Disclosure` 封装 Collapsible 并处理检查项、评审历史的深链接展开；`ChoiceSelect` 统一 Select 的触发器及选项；`WorkspacePanels` 使用 Resizable 管理三栏边界、宽度、折叠与评审栏位置。
- 添加组件可在 `apps/web` 运行 `pnpm dlx shadcn@latest add <component>`。现有组件已定制，升级或覆盖前先比较差异；升级后继续映射 Modern Slate 令牌并验证实际页面。

## 验证范围

本次验证使用现有 5173 开发入口。既有项目和 Run 只读浏览，覆盖搜索、筛选、键盘菜单、标签页、深链接、按需文本、图片预览、删除预览取消及交付汇总取消。工作台检查 1120px/1440px/1920px，Landing Page 检查 390px/1440px、截图与主题五页签、复制、下载和弹窗焦点恢复。

写入行为在独立 8766 服务与 `.scratch/shadcn-ui/test-data` 数据库验证，覆盖项目/需求创建、创建失败保留输入并重试、逐项理由规则、评论、全量交付、作废和级联删除。创建失败使用一次 HTTP 503 注入，其余请求转发到真实测试 API。测试中的接受/拒绝属于合成夹具，不是对既有业务 Run 的人工验收。

本地浏览器脚本、截图和最终检查日志保存在 `.scratch/shadcn-ui/`，不进入 Git。验证结果以本次实际执行日志为准。

清理回归对照覆盖 16 个页面状态的元素位置、尺寸和计算样式，以及 Landing 桌面、移动端与主题页签截图。清理日志与对照保存在 `.scratch/style-cleanup/`，此次写入回归使用独立 `.scratch/style-cleanup/test-data` 数据库。现有 `theme.css` 令牌保持不变。
