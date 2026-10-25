# 05 集成、文档、验证与双轴审查

Type: task
Status: resolved
Blocked by: 02, 03, 04

集成所有工作分支，完成真实本机 API + 受控外部 Lark 子进程的端到端验证，修复协议冲突。更新 contracts、README、工具链与实现回执，运行项目格式/lint/类型/相关 Go 与 Web 检查、构建及 agent 检查。实施 code-review 技能的 Standards / Spec 双轴审查并修复实质问题。

真实双成员电脑、真实 PRD 与 VPS 验收不能由模拟结果替代；无环境时记录为 ready-for-human 的外部验收，不写成通过。部署、推送不在本任务授权内。

## Comments

- 2026-10-26：02/03/04 已由独立 merger 合入，当前代码 `90f67bb`。开始完整链路、统一检查、真实页面、隔离备份恢复与双轴审查；实际外部验收保留独立交接。

## Answer

所有实施任务已合入 `codex/lark-prd-import`。最终代码整合 `754210d` 包含独立审查发现的最小重试等待、PRD 版本提示、租约恢复取消及旧回调续租竞态修正；最后两轴复核均无未关闭项。公开 CLI/HTTP 与隔离 MySQL 的最终完整链路 20.479 秒通过，lint/类型检查通过。全量测试、真实浏览器和真实备份恢复的实际提交及覆盖边界见[集成验证回执](../integration-verification.md)。

[真实环境验收](../external-acceptance.md)独立保留 ready-for-human，PRD 分析和用例生成仍为 TODO。本次不推送、部署或替换日常入口。Web 工作树已通过桌面工具归档；另两处工具报“Another active task still uses this worktree.”而保留，不绕过占用保护。
