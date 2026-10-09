---
name: acceptances-v1
description: 在业务目录执行真实验证，向本机 Acceptances 保存报告与附件；处理首次关联、局部复验、上传重试与人工反馈读取。
---

# 本地验证归档

Acceptances 保存验证事实供人验收。Project 关联一个或多个 Repository；Campaign 对应需求交付；每次实际验证形成新的 Run。保存成功不等于人工接受。

## 流程

1. 定位 CLI：先用 `command -v acceptances`；未在 PATH 时使用本 skill 目录下 `bin/acceptances`。执行 `acceptances help` 获取命令。CLI 不依赖 Acceptances 源码、Node、token 或契约目录。
2. 在业务目录运行 `acceptances context`。若未关联，运行 `acceptances projects`，按用户已指明的产品选择 Project，用 `acceptances link --project <名称或ID>` 建立关联。多个匹配且上下文无法判断时再询问；没有 Project 时请用户在 Web 创建。自定义本地服务仅在首次关联时传 `--url`。关联自动保存在宿主机，同仓库 worktree 共用；不同仓库分别关联同一 Project。
3. 运行 `acceptances campaigns` 查找本次需求；按既有交付选择 Campaign，新需求用 `acceptances campaigns --title <标题> --description <说明>` 创建。复验继续使用原 Campaign。
4. 根据用户需求执行真实验证。记录本次覆盖范围、环境、预期与实际结果，以及真实附件。失败、阻塞和跳过也应如实保存。每个实际验证使用新的 bundle 目录，按 [报告格式](references/report.md) 写入 `report.json` 与附件。多仓库各运行一次 `acceptances context --repo <目录>`，将返回的 version 填入报告。
5. `acceptances publish --bundle <目录> --campaign <标题或ID>` 整包提交。成功以返回 Run 为准，并向用户给出 Web 的 Run 链接。上传失败保留目录内的 `.submission-id` 与内容，原命令重试；相同 ID、不同内容的冲突须说明原因，不通过换 ID 掩盖冲突。若报告需要修正，告知用户在 Web 补充说明或作废；重新执行验证才建新 Run。
6. 用 `acceptances status --run <ID>` 查看该 Run；`acceptances feedback --campaign <标题或ID>` 读取历次 Run 与人工反馈。用户提出修复后重新验证，保留历史结果，不自动合并为全部通过。

## 人审边界

Agent 只保存事实并读取反馈。接受、拒绝、作废及删除由用户在 Web 操作；不代替人作出验收决定。完整报告和附件全部保存后才算归档成功，CLI 返回失败时不得报告已交付。
