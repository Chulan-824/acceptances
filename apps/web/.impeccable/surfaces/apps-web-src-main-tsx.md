---
version: 1
slug: "apps-web-src-main-tsx"
primary_target: "apps/web/src/main.tsx"
related_targets: ["apps/web/src/home.tsx", "apps/web/src/home.css"]
---

# 首页

Mode: Operate

## Direction contract

THESIS: 首页优先展示已有项目，创建项目作为可发现的次要入口，按用户已确认的 OpenDesign homepage-redesign.html 实现。

OWN-WORLD: 沿用 Modern Slate 冷灰画布、白色表面、深色按钮、系统中文字体、细边框和轻圆角。首页局部标题为 28px，项目名称 18px。

STORY: 用户进入首页后选择项目查看需求与验证记录，或填写名称与可选说明创建项目。创建成功自动进入新项目，失败保留输入。

FIRST VIEWPORT: 1440px 时居中的 1120px 容器，两侧内边距 32px；紧凑 72px 顶栏，下方标题及说明，左侧项目卡片列表、右侧 320px 创建表单。非三栏页面适配响应式视口，小屏单列堆叠；32px 交互控件触控热区扩展至 44x44px。

FORM: 用户已确认的 OpenDesign 独立设计稿，原生成 run 7e9412d8-aac0-48b3-822b-f6c048231147；不再生成候选。移除设计演示说明，所有操作连接当前真实接口。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
