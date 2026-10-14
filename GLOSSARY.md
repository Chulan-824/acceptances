# Acceptances 领域词汇表

本词汇表记录本地精简版已确认的领域用语。重构边界见 [ADR-0001](docs/adr/0001-local-report-archive.md)，完整方案见[设计记录](.scratch/local-simplification/spec.md)。逐项人工评审的规则见 [ADR-0002](docs/adr/0002-per-check-human-review.md)，一键交付见 [ADR-0003](docs/adr/0003-bulk-human-acceptance.md)。当前实现与验证状态见[实现交接](docs/v1-implementation-handoff.md)。

## Language

**Project**：被验收的产品或系统，是需求交付与验证记录的共同归属。一个 Project 可以关联多个本地代码目录。

**Repository**：Project 关联的一处代码来源。同一代码来源可以有多个本地工作目录，同一次需求交付可以涉及多个 Repository。

**Campaign**：围绕一次需求交付组织的验收活动，包含针对该交付开展的多次验证。
_Avoid_：Round，不将需求交付与一次验证混称。

**Run**：外部执行者实际开展的一次验证记录，归属一个 Campaign，保存当次检查项、实际结果、证据和代码版本信息。允许仅验证部分范围，不自动合并历史结果；失败的验证同样属于 Run。

**Check Item**：一次验证中需要检查的具体行为或预期，报告记录其实际结果及相关证据。

**Evidence**：支持验证结果的实际材料，例如截图、录像或执行日志。

**Review**：人查看验证结果和证据后，针对具体 Run 或其中某个 Check Item 给出的评论或人工判断。人工判断与原始验证结果分别表达，新的 Run 不继承旧的人工判断。

**Check Review**：人针对某个 Run 中单个 Check Item 给出的通过、不通过判断、撤回判断或评论；当前人工判断以最新明确判断为准，历史评审保留，评论本身不改变人工判断。

**Run Acceptance**：一次 Run 中每个 Check Item 的当前人工判断均为通过时形成的结论，页面称本轮已验收，仅代表本轮验证范围。后续改判或撤回会改变该结论。

**批量人工通过**：人一次确认当前 Run 的全部 Check Item 人工通过，表达对本轮所有检查项的同意。可覆盖此前的不通过判断，原判断历史仍保留。

**Verification Scope**：一次 Run 对需求交付的覆盖范围，区分完整验证、局部验证和范围未知；局部验证的人工通过不代表需求整体通过。

**Feedback Response**：外部执行者在新 Run 中对来源 Run 的某条人工反馈给出的处理说明及复验检查项关联，不等于该反馈已经获得新的人工接受。

**Void**：因报告整体有误而将 Run 标记为作废，保留原报告及作废原因。作废记录不能接受，作废不同于删除。

以下术语用于正式交付与业务说明。具体材料规则见[交付材料](skills/acceptances-v1/references/delivery.md)，决策与对齐历史见[规划记录](.scratch/delivery-snapshot-business-doc/spec.md)。

**Verification Map**：列出某版需求的业务功能及其必验检查项的范围地图，是核对一次交付验证是否覆盖约定范围的依据。

**Delivery Snapshot**：人明确确认的一份不可变交付内容记录，绑定指定最终 Run、确认时的人工审核结论、交付版本、范围地图与证据。交付当前效力另行表达，后续变化不改变冻结时的事实。
_Avoid_：本轮已交付，不将当前人工验收结论与正式交付记录混称。

**Documentation Materials**：项目侧 Agent 随交付准备的结构化业务说明素材，描述功能、操作步骤、角色前提、限制及对应截图的来源。

**Business Document**：关联某份 Delivery Snapshot 的独立版本业务说明，以 Documentation Materials 和已审核证据为依据。业务说明的版本变化不改变原交付记录或验证事实。

**Delivery Effect**：一份交付当前是否有效的结论，包括有效、失效、主动撤销和已被替代。后续改判可以改变当前效力，冻结内容与效力变化的历史分别保留。
