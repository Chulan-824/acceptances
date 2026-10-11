# Acceptances 领域词汇表

本词汇表记录本地精简版已确认的领域用语。重构边界见 [ADR-0001](docs/adr/0001-local-report-archive.md)，完整方案见[设计记录](.scratch/local-simplification/spec.md)。逐项人工评审的规则见 [ADR-0002](docs/adr/0002-per-check-human-review.md)。当前实现与验证状态见[实现交接](docs/v1-implementation-handoff.md)。

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

**Run Acceptance**：一次 Run 中每个 Check Item 均获得人工通过后形成的整轮人工通过结论，仅代表本轮验证范围。

**Verification Scope**：一次 Run 对需求交付的覆盖范围，区分完整验证、局部验证和范围未知；局部验证的人工通过不代表需求整体通过。

**Feedback Response**：外部执行者在新 Run 中对来源 Run 的某条人工反馈给出的处理说明及复验检查项关联，不等于该反馈已经获得新的人工接受。

**Void**：因报告整体有误而将 Run 标记为作废，保留原报告及作废原因。作废记录不能接受，作废不同于删除。
