---
version: 1
slug: "apps-web-src-main-tsx"
primary_target: "apps/web/src/main.tsx"
related_targets: ["apps/web/src/home.tsx", "apps/web/src/home.css"]
---

# 首页

Mode: Operate

## Direction contract

THESIS: 首页优先展示真实需求交付看板，项目筛选与创建作为辅助入口；交付状态以最新 Run 与人工判断表达。

OWN-WORLD: 2026-10-19 全站迁移为 Refero Vercel 中性黑白、Geist Sans / Mono 自托管、6px 圆角、细边框与平面容器；业务状态保留彩色与文字，中文保留系统字体回退。数值以根 DESIGN.md 和 theme.css 为准。

STORY: 用户进入首页后选择项目查看需求与验证记录，或填写名称与可选说明创建项目。创建成功自动进入新项目，失败保留输入。

FIRST VIEWPORT: 最大 1280px 容器，64px 顶栏、统计与筛选、左侧需求交付卡片和右侧项目/创建面板；窄屏单列，图标控件保留 44px 热区。

FORM: 保留现有看板和业务交互结构，视觉由 2026-10-19 用户明确授权的 Refero Vercel 全站主题替换。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
