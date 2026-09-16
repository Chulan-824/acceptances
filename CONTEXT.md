# Domain glossary

## Acceptance

一个由人判断交付是否满足业务目标的跨轮决策记录。

## Subject

一组 Round 共同归属的稳定交付主题。

## Round

某一时刻针对 Subject 产生的一次完整验证快照。

## Draft Round

尚未封存、允许修正作者错误的 Round。它不参与正式历史或人审。

## Raw Round

builder 产生的原始验证事实，包括结构化结果、叙事报告、证据资产及公开的可选辅助记录。校验不会改写它。

## Published Round

已通过可发布性校验并封存的 Round。后续修复必须创建新 Round。

## Derived Model

validator 从 Raw Round 计算出的只读解释。默认值、门禁剔除、证据充分性和诊断只存在于这个模型。

## Ruleset

具有稳定版本的一组公开校验规则。Published Round 永远绑定封存时使用的 Ruleset。

## Receipt

把 Published Round 绑定到内容摘要、Ruleset、发布时间和稳定次序的本地记录。

## Validation Outcome

Round 的可发布性结果：`ready` 可进入人审，`held` 可保留但不能完成验收，`rejected` 不得进入正式历史。

## Review Overlay

人对某个 Published Round 检查项作出的 accept 或 reject。它独立于 Raw Round，不能改变跑测事实。

## Legacy Round

在 Receipt 机制建立前产生、尚未与内容摘要及 Ruleset 绑定的 Round。

## Diagnostic

validator 对一条规则的结构化判断。effect 为 reject、hold、drop、normalize 或 advisory。
