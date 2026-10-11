---
name: acceptances-v1
description: 在业务目录执行真实验证并向本机 Acceptances 保存报告与附件；处理首次关联、上传重试，以及读取逐项人工反馈后的修复与复验关联。
---

# 本地验证归档

Acceptances 保存验证事实供人验收。Project 关联一个或多个 Repository；Campaign 对应需求交付；每次实际验证形成新的 Run。保存成功不等于人工接受。

## 流程

1. 定位 CLI：先用 `command -v acceptances`；未在 PATH 时使用本 skill 目录下 `bin/acceptances`。执行 `acceptances help` 获取命令。CLI 不依赖 Acceptances 源码、Node、token 或契约目录。
2. 在业务目录运行 `acceptances context`。若未关联，运行 `acceptances projects`，按用户已指明的产品选择 Project，用 `acceptances link --project <名称或ID>` 建立关联。多个匹配且上下文无法判断时再询问；没有 Project 时请用户在 Web 创建。自定义本地服务仅在首次关联时传 `--url`。关联自动保存在宿主机，同仓库 worktree 共用；不同仓库分别关联同一 Project。
3. 运行 `acceptances campaigns` 查找本次需求；按既有交付选择 Campaign，新需求用 `acceptances campaigns --title <标题> --description <说明>` 创建。复验继续使用原 Campaign。
4. 首次验证直接按需求执行。用户要求根据人工反馈修复或复验时，先按 [反馈处理](references/feedback.md) 读取指定来源 Run 的当前逐项判断和评论，确认本次处理范围与修复授权；复验继续归属原 Campaign。
5. 执行真实验证，记录环境、预期与实际结果以及真实附件。每次实际验证使用新的 bundle 目录，按 [报告格式](references/report.md) 写入 `report.json` 与附件，明确 `scopeType` 和本次范围。反馈复验填写 `followUp`，逐条关联来源反馈、处理说明和本次检查项。多仓库各运行一次 `acceptances context --repo <目录>`，将返回的 version 填入报告。失败、阻塞和跳过如实保存；未重跑的内容写入范围说明。
6. `acceptances publish --bundle <目录> --campaign <标题或ID>` 整包提交。成功以返回 Run 为准，并向用户给出 Web 的 Run 链接。上传失败保留目录内的 `.submission-id` 与内容，原命令重试；相同 ID、不同内容的冲突须说明原因，不通过换 ID 掩盖冲突。已保存报告有文字错误时用评论纠正，整体错误由用户作废；完成新的实际验证才建新 Run。
7. 用 `acceptances status --run <ID>` 核对新 Run，确认范围、反馈关联、实际结果及归档回执。向用户说明本轮覆盖内容和未完成项，等待新一轮逐项人审。读取反馈或改写文字本身不产生新 Run。

## 人审边界

Agent 保存验证事实并读取反馈。用户在 Web 对每个检查项通过、不通过、撤回或评论；整轮状态由系统计算，全部逐项人工通过才整轮通过。新 Run 的各项从待审开始。评论不改变人工判断，原始 `passed`、`failed`、`blocked`、`skipped` 结果保持不变。

只有最新完整范围 Run 全部人工通过，Campaign 才通过。局部或范围未知的 Run 通过仅代表本轮，Campaign 仍待审。反馈响应不继承人工判断、不自动关闭原反馈。

验证指令本身不授权修改业务代码。逐项判断、作废及删除由用户在 Web 操作，Agent 不代替人提交判断。用户保存评论后仍在业务聊天中触发 Agent，Acceptances 不调度或自动唤醒 Agent。完整报告和附件全部保存后才算归档成功，CLI 返回失败时不得报告已交付。
