# ADR-0001: 本地兼容 LobeHub acceptance 公开校验规则

Status: Accepted

## Context

本地 acceptance 已能原位读取 Round、聚合历史并记录人审，但此前没有运行时 validator。页面可读不代表 Round 符合 LobeHub acceptance 的公开输入和证据规则。

完整复制 Cloud 会引入数据库、鉴权、上传和未公开黑盒行为，不符合本地离线目标。校验逻辑若分别落在 CLI 和 renderer，又会形成两份真值。

## Decision

以当前 acceptance v0.1.0 公开文档为第一个版本化 Ruleset。只承诺公开、确定、可离线观察的行为兼容；未公开行为进入差异清单。

建立一个共享 validator，由 CLI 和 Round 读取边界共同调用。validator 不改写 Raw Round，只返回 Derived Model 和稳定 Diagnostic。

Draft Round 经显式 seal 后成为 Published Round。Receipt 记录 SHA-256、Ruleset、稳定 sequence 和 sealedAt。Review Overlay 不进入内容摘要。

Validation Outcome 分为 ready、held 和 rejected。公开规则明确要求的 drop、normalize 和 evidence hold 按原语义执行；公开了约束但没有公布非法处置的结构问题在本地 fail closed，并标记 local-safety 或 compat-assumption。

现有 catalog、renderer 和本地 Review Overlay 继续作为外壳。Cloud transport、operation、check result、数据库和远程页面不在本决策内。

## Consequences

- CLI 与 renderer 对同一 Round 得到同一结果。
- 旧 Round 在显式迁移前显示为 Legacy Round，不自动进入正式历史。
- Published Round 被修改后会被隔离；修改 Receipt 和 Raw Round 的恶意本机用户不在威胁模型内。
- Ruleset 升级不能改变旧 Round；引用中的旧版本需要长期保留。
- 公开文档未定义的 evidence 映射和 gate matcher 细节必须显示为兼容假设。
- 修复 validator 拒绝的问题可能要求修改 Draft Round；修复 Published Round 必须创建下一轮。
