# Acceptances 领域词汇表

本词汇表记录本地精简版已确认的领域用语。重构边界见 [ADR-0001](docs/adr/0001-local-report-archive.md)，完整方案见[设计记录](.scratch/local-simplification/spec.md)。当前实现与验证状态见[实现交接](docs/v1-implementation-handoff.md)。

## Language

**Project**：被验收的产品或系统，是需求交付与验证记录的共同归属。一个 Project 可以关联多个本地代码目录。

**Repository**：Project 关联的一处代码来源。同一代码来源可以有多个本地工作目录，同一次需求交付可以涉及多个 Repository。

**Campaign**：围绕一次需求交付组织的验收活动，包含针对该交付开展的多次验证。
_Avoid_：Round，不将需求交付与一次验证混称。

**Run**：外部执行者实际开展的一次验证记录，归属一个 Campaign，保存当次检查项、实际结果、证据和代码版本信息。允许仅验证部分范围，不自动合并历史结果；失败的验证同样属于 Run。

**Check Item**：一次验证中需要检查的具体行为或预期，报告记录其实际结果及相关证据。

**Evidence**：支持验证结果的实际材料，例如截图、录像或执行日志。

**Review**：人查看验证结果和证据后，针对具体 Run 给出的反馈或接受、拒绝决定。新的 Run 不继承旧决定，保存成功与验证通过均不等于人工接受。

**Void**：因报告整体有误而将 Run 标记为作废，保留原报告及作废原因。作废记录不能接受，作废不同于删除。
