---
name: acceptances-v1
description: 在业务目录执行真实验证并向本机 Acceptances 保存报告与附件；处理首次关联、上传重试、逐项反馈复验，以及正式交付所需的地图和业务说明素材准备。
---

# 本地验证归档

Acceptances 保存验证事实供人验收。Project 关联一个或多个 Repository；Campaign 对应需求交付；每次实际验证形成新的 Run。保存成功不等于人工接受。

用户要求正式冻结交付或业务说明时，在步骤 5 发布报告前读取[正式交付材料](references/delivery.md)，准备地图、说明素材及需求/构建版本清单；完成条件是全部材料与实际证据随同一个真实 Run 归档，并提供人审入口。冻结及文档生成由用户在 Web 确认。

## 流程

1. 定位 CLI：先用 `command -v acceptances`；未在 PATH 时使用本 skill 目录下 `bin/acceptances`。执行 `acceptances help` 获取命令。CLI 不依赖 Acceptances 源码、Node 或契约目录。API 需要账号会话；用户先在 Web 注册，再在本机执行 `acceptances login --url <API地址> --username <用户名> --password-stdin`。密码由用户在本机通过标准输入提供，Agent 不索取密码、不读取或回显会话文件。遇到 401 请用户重新登录，不绕过认证；按 API 地址保存会话。
2. 在业务目录运行 `acceptances context`。若未关联，运行 `acceptances projects`，按用户已指明的产品选择 Project，用 `acceptances link --project <名称或ID>` 建立关联。多个匹配且上下文无法判断时再询问；没有 Project 时请用户在 Web 创建。`--url` 指向 API；API 与 Web 地址不同时，在 `link` 同时传 `--web-url <Web地址>`（本地开发例如 `--url http://127.0.0.1:8765 --web-url http://127.0.0.1:5173`）。两个地址保存在关联中；同源部署可省略 `--web-url`，默认沿用 API 地址。旧关联端口不正确时，重新执行同一 Project 的 `link` 更新地址，不创建 Campaign 或 Run。关联自动保存在宿主机，同仓库 worktree 共用；不同仓库分别关联同一 Project。
3. 运行 `acceptances campaigns` 查找本次需求；按既有交付选择 Campaign，新需求用 `acceptances campaigns --title <标题> --description <说明>` 创建。复验继续使用原 Campaign。
4. 首次验证直接按需求执行。用户要求根据人工反馈修复或复验时，先按 [反馈处理](references/feedback.md) 读取指定来源 Run 的当前逐项判断和评论，确认本次处理范围与修复授权；复验继续归属原 Campaign。
5. 执行真实验证，记录环境、预期与实际结果以及真实附件。需要浏览器验证时，先按 [可选 Jev 执行](references/jev-browser.md) 探测本机配置；可用时优先尝试 Jev，不可用时继续原有浏览器流程。用户明确禁用 Jev 或只允许指定工具时遵从用户选择。每次实际验证使用新的 bundle 目录，按 [报告格式](references/report.md) 写入 `report.json` 与附件，明确 `scopeType` 和本次范围。反馈复验填写 `followUp`，逐条关联来源反馈、处理说明和本次检查项。多仓库各运行一次 `acceptances context --repo <目录>`，将返回的 version 填入报告。失败、阻塞和跳过如实保存；未重跑的内容写入范围说明。
6. 发布前执行 `acceptances validate --bundle <目录>`；正式交付加 `--formal --project <实际ID> --campaign <实际ID>`，检查完整范围、版本绑定、材料引用与摘要。新增截图统一为真实 JPEG，先编码再计算摘要，不改写历史附件。预检失败先修正本次待发布包，不能缩减检查范围或改旧 Run。`acceptances publish --bundle <目录> --campaign <标题或ID>` 整包提交，正式交付加 `--formal`；发布入口再次预检，通过前不创建 submission ID 或 Run。成功以返回 Run 为准，并向用户给出 Web 的 Run 链接。上传失败保留目录内的 `.submission-id` 与内容，原命令重试；相同 ID、不同内容的冲突须说明原因，不通过换 ID 掩盖冲突。已保存报告有文字错误时用评论纠正，整体错误由用户作废；完成新的实际验证才建新 Run。
7. 用 `acceptances status --run <ID>` 核对新 Run，确认范围、反馈关联、实际结果及归档回执，并在真实浏览器打开回执的 `webUrl`，核对项目、Campaign 与 Run。只纠正链接时使用这个只读命令，不重新 publish 或 move-run；`--web-url` 可仅覆盖本次回执地址。向用户说明本轮覆盖内容和未完成项，等待用户逐项评审或一键确认本轮交付。读取反馈或改写文字本身不产生新 Run。

## 人审边界

Agent 保存验证事实并读取反馈。用户在 Web 对每个检查项通过、不通过、撤回或评论，也可点击“一键交付”并确认当前 Run 的全部检查项人工通过。批量可覆盖已有不通过判断且无需理由，原历史保留；逐项操作保留原理由规则。整轮状态由系统计算，全部人工通过即本轮已交付，仍可改判或撤回。新 Run 的各项从待审开始。评论不改变人工判断，原始 `passed`、`failed`、`blocked`、`skipped` 结果保持不变。

只有最新完整范围 Run 全部人工通过，Campaign 才通过。局部或范围未知的 Run 通过仅代表本轮，Campaign 仍待审。反馈响应不继承人工判断、不自动关闭原反馈。

验证指令本身不授权修改业务代码。逐项判断、一键交付、作废及删除由用户在 Web 操作，Agent 不代替人提交判断。用户保存评论后仍在业务聊天中触发 Agent，Acceptances 不调度或自动唤醒 Agent。完整报告和附件全部保存后才算归档成功，CLI 返回失败时不得报告已交付。
