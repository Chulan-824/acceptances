# Acceptance validator rule matrix

> 来源与修改说明（2026-10-08）：公开规则经 AI 参考后整理，增加本地安全／兼容假设分类。基准为 `lobehub/lobehub@1c7a7116313bcc2d675937139554a244f7adf7a0`；上游规则表达及改写保留 LobeHub Community License + Apache-2.0，Copyright (c) 2024/06/17 - current LobeHub LLC. All rights reserved. 本地表达待核实。见 [范围](../LICENSE-SCOPE.md)、[NOTICE](../NOTICE)、[来源修改记录](../docs/licensing/lobehub-provenance.md)。

Ruleset: `lobehub-acceptance-public@0.1.0`

本表是第一阶段的完成清单。`source` 区分公开规则、兼容假设和本地安全边界。

| Dimension | Source | Effect | Diagnostic or behavior | Verification |
| --- | --- | --- | --- | --- |
| result、report、assets 存在 | lobehub-public | reject | `ROUND_FILE_MISSING` | fixture |
| Round 目录时间戳格式 | lobehub-public | reject | `ROUND_NAME_INVALID` | fixture |
| createdAt 带时区 | lobehub-public | reject | `CREATED_AT_INVALID` | fixture |
| title 缺失 | lobehub-public | hold | `ROUND_TITLE_MISSING` | fixture |
| summary verdict 缺失 | lobehub-public | hold | `SUMMARY_VERDICT_MISSING` | fixture |
| plan/case 必填字段 | lobehub-public | reject | `REQUIRED_STRING_MISSING` | fixture |
| verifier 缺失 | lobehub-public | normalize | `VERIFIER_DEFAULTED` | fixture |
| verifier、status、surface、verdict 封闭词表 | lobehub-public | reject | field-specific code | fixture |
| electron surface | lobehub-public | normalize | `SURFACE_NORMALIZED` | fixture |
| plan/case ID 唯一且配对 | lobehub-public | reject | ID diagnostics | fixture |
| plan 无 case | lobehub-public | hold | `PLAN_NOT_RUN` | fixture |
| summary 与 cases 冲突 | local-safety | reject | `SUMMARY_COUNT_MISMATCH` | fixture |
| verdict 与 fail/blocked/not-run 冲突 | local-safety | reject | `SUMMARY_VERDICT_MISMATCH` | fixture |
| tests、coverage、tsc、lint、format、build、CI | lobehub-public | drop | `PROGRAMMATIC_GATE_DROPPED` | bilingual positive/negative fixtures |
| gates-only Round | lobehub-public | reject | `NO_ACCEPTANCE_CHECKS` | fixture |
| required evidence 类型缺失 | lobehub-public | hold | `REQUIRED_EVIDENCE_MISSING` | fixture |
| pass/fail 无证据 | lobehub-public | hold | `CASE_EVIDENCE_MISSING` | fixture |
| evidence 类型映射 | compat-assumption | advisory/hold | `EVIDENCE_TYPE_UNKNOWN` | extension fixtures |
| comparison 默认 horizontal | lobehub-public | normalize | `COMPARISON_LAYOUT_DEFAULTED` | fixture |
| comparison 不完整 | local-safety | reject | `COMPARISON_PAIR_INCOMPLETE` | fixture |
| dataset/view ID、字段和 encoding | lobehub-public | reject | visualization diagnostics | six-renderer fixture |
| inline rows 超过 10,000 | lobehub-public | reject | `DATASET_ROW_LIMIT_EXCEEDED` | boundary fixture |
| nested assets | lobehub-public | accept | shared safe resolver | integration test |
| traversal、absolute、symlink、非普通文件 | local-safety | reject | asset diagnostics | filesystem fixtures |
| HAR、environment file | local-safety | reject | `SENSITIVE_ASSET_FORBIDDEN` | filesystem fixture |
| 文本证据疑似未脱敏凭据 | local-safety | reject | `EVIDENCE_SECRET_DETECTED` | redacted/unredacted fixtures |
| 未引用资产 | lobehub-public | advisory | `ASSET_UNREFERENCED` | fixture |
| unknown object field | compat-assumption | advisory | `COMPAT_UNKNOWN_FIELD` | fixture |
| interaction trace 缺失 | lobehub-public | none | no diagnostic | fixture |
| foreign/unpriceable trace record | lobehub-public | none | no cost | fixture |
| 已有 interactionCost | lobehub-public | preserve | no rewrite | fixture |
| supersedes 引用、完整谱系、无分叉 | lobehub-public/local-safety | reject | history diagnostics | history fixture |
| 已 accept 检查重跑 | lobehub-public | advisory | `ACCEPTED_CHECK_REPEATED` | history fixture |
| reject 未处理 | lobehub-public | hold | `REJECT_UNRESOLVED` | history fixture |
| Review Overlay 损坏 | local-safety | hold | `REVIEW_OVERLAY_INVALID` | fixture |
| pre-seal review | local-safety | advisory/stale | `PRESEAL_REVIEW_STALE` | fixture |
| Receipt digest 改变 | local-safety | reject | `ROUND_TAMPERED` | receipt test |
| Receipt ruleset 不可用 | local-safety | reject | `RULESET_UNAVAILABLE` | receipt test |

## Advisory-only public guidance

以下规则需要理解证据内容，第一阶段不假装进行可靠机械判断：

- 非视觉行为的 reasoning 与 execution 双文本证据。
- 音频是否听过、是否静音、是否表达目标内容。
- 截图是否人工查看并证明预期状态。
- 静态图是否确实没有 native visualization 可替代。
- report 是否只包含叙事尾部。

## Explicit black-box gaps

- Cloud gate matcher 的精确正则、分词和误报边界。
- 未公开字段 coercion、错误优先级和 unknown-field 策略。
- 完整 MIME sniffing、损坏媒体识别和上传限制。
- Cloud stale-review 与 userReview 聚合细节。
- `goms-klm@lobe-v1` 计价常量。
- operation、check result、上传、数据库、鉴权和远程页面。
