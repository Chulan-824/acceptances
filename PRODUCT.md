# Acceptances

<!-- impeccable:product-schema 1 -->

本文记录整个 Acceptances 产品的共享背景，适用于 Web、API、CLI 和 Agent 接入。产品定位与使用边界于 2026-10-10 经用户确认；领域定义以 [GLOSSARY.md](GLOSSARY.md) 为准，架构决策以 [ADR-0001](docs/adr/0001-local-report-archive.md) 为准。

## Platform

web

## Users

主要用户是使用 Agent 开发并验证需求的个人开发者。用户在自己的电脑上查看验证报告与证据，判断某次需求交付是否可以接受。

Agent 是外部验证执行者，在业务目录和实际验证环境开展检查，通过宿主机 CLI 归档结果并读取反馈。人工接受与拒绝由用户决定。

## Product Purpose

将一次需求交付的验证事实、证据、代码版本与人工反馈保存在同一处，便于用户查看本次结果及复验历史。

成功意味着用户能判断这次验证检查了什么、在什么环境与代码版本上执行、实际结果如何，以及证据是否支持结论。归档成功、检查通过和人工接受分别表达。

## Positioning

Acceptances 围绕 Project → Campaign → Run 组织验证记录。每次实际验证形成独立 Run，报告与附件保存后不覆盖；用户针对该 Run 反馈、接受或拒绝。

个人本机使用的范围让创建项目、关联业务目录和归档验证直接连起来，无需账号、token 或外部数据库。Acceptances 保存外部执行产生的结果，测试与 Agent 执行留在业务环境中。

## Operating Context

1. 用户在本机启动服务，在 Web 创建 Project。
2. 用户在业务目录调用 `acceptances-v1` skill，选择已有 Project 并建立宿主机关联。同仓库 worktree 共用关联，多个仓库可以归属同一个 Project。
3. Agent 为一次需求交付创建或选择 Campaign，在业务环境执行本次验证。
4. CLI 整包保存结构化报告和截图、录像、日志等证据。上传失败后使用原提交 ID 与原内容重试。
5. 用户在 Web 查看检查项、证据与历史 Run，补充说明、接受、拒绝或作废。Agent 可通过 CLI 读取结果及反馈。
6. 重新实际验证新增 Run，继续归属对应 Campaign，并重新等待人工评审。

部署为单个 Go 应用容器，同时提供 API 和构建后的 React Web。SQLite 与本地证据文件放在一个持久数据卷中，默认仅通过 `127.0.0.1:8765` 访问，启动自动初始化与迁移。

开发入口为仓库根目录的 `make dev`，Web 地址为 `http://127.0.0.1:5173`，通过 Vite 代理访问本机 API。安装和操作步骤见 [README.md](README.md) 与 [Agent 接入](docs/agents/v1-integration.md)。

## Capabilities and Constraints

- Project 表示被验收的产品或系统；Campaign 围绕一次需求交付；Run 记录一次实际验证。Repository 表示代码来源，具体定义复用领域词汇表。
- 报告记录需求标题与说明、验证时间、本次范围、环境、代码版本及未提交改动标记，以及 Check Item 的预期、实际结果、状态与 Evidence。检查状态为 `passed`、`failed`、`blocked`、`skipped`。
- 失败结果与局部验证均可归档。版本、环境或未提交改动情况未知时明确显示未知，不补造信息。
- 局部复验只表达本次范围，不自动合并历史通过结果，也不计算拼接后的整体通过。
- Review 与接受、拒绝决定绑定具体 Run。新增 Run 后 Campaign 待审，旧决定保留在旧 Run；历史 Run 的决定不改变需求当前状态。
- 已保存报告及附件不能原地修改。文字纠错通过补充说明，整体错误通过 Void 保留作废原因。作废 Run 不能接受。
- 相同提交 ID 与相同内容返回既有 Run；相同 ID 与不同内容返回冲突。完整报告与全部附件保存完成后才可见，上传重试不产生新 Run。
- Web 支持项目与需求管理、结果搜索和筛选、当前及历史 Run 浏览、图片和视频及文本证据查看、下载与人工反馈。
- Web 支持删除 Project、Campaign 或 Run，确认时展示级联影响范围。删除清理所属报告、附件与反馈；删除最新 Run 后需求待审，不恢复旧接受状态。无回收站或自动历史清理。
- 无认证时，人工决定依赖产品流程和 Agent 使用约定，不承诺通过身份凭据区分人和 Agent。验证指令本身不授权修改业务代码或自动作出人工接受决定。
- 当前产品范围不包含远程访问、团队协作、多实例部署、对象存储、在容器中执行 Agent 或业务测试、跨 Run 覆盖合并、旧协议兼容及旧数据迁移。
- 公开分发范围与许可条件尚未确定，以 [LICENSE-SCOPE.md](LICENSE-SCOPE.md) 和许可文档为准，不将本机运行记录写成公开发行或全仓开源声明。

## Brand Commitments

产品名称为 Acceptances。现有 Web 使用简体中文，入口文案为“交付验证”和“保存验证事实，查看证据，作出人工判断。”后续产品文案使用具体、直接的描述，明确当前报告、历史报告、本次验证范围与人工状态。

现有界面、主题和设计来源见 [设计参考](docs/design-reference.md)。本记录不新增视觉方向。

## Evidence on Hand

- [领域词汇表](GLOSSARY.md)、[ADR-0001](docs/adr/0001-local-report-archive.md)、[Agent 接入](docs/agents/v1-integration.md) 和 [实现交接](docs/v1-implementation-handoff.md) 记录产品契约与验证方法。
- `apps/web/src/` 包含实际网页实现；`packages/api-client/` 包含其 HTTP 客户端与类型；`skills/acceptances-v1/` 包含宿主机验证接入流程与报告格式。
- 本地 `.scratch/local-simplification/verification/REPORT.md` 记录 2026-10-09 的平台实施验收，相关回执和截图位于 `artifacts/local-simplification/`。这些目录不进入 Git，其他 checkout 不保证存在；该记录不代表此后每次代码变更或业务需求已验收。
- 本地 `artifacts/workbench/` 与 `artifacts/reviewbar/` 存有桌面和窄屏界面截图。使用前核对截图与当前实现是否一致。
- 本次 init 核对了仓库文档和网页实现，未重新执行 Docker、CLI 或浏览器验收。平台测试数据与合成媒体不作为客户案例、业务成果或用户背书。

## Product Principles

1. 保留每次验证的事实。失败、阻塞、未执行和未知信息均明确表达。
2. 让判断有具体依据。报告、证据、环境与代码版本对应同一次 Run。
3. 人工决定有明确归属。保存与检查结果不替用户作出接受决定，复验不继承旧决定。
4. 保持个人本机使用的接入成本。业务执行留在宿主机，归档服务无需账号与外部基础设施。
