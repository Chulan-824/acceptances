# Lark PRD 导入实施地图

## Notes

- 设计：[spec](spec.md)，共享协议：[implementation-contract](implementation-contract.md)。
- 用户已授权开发及任务相关本地提交/合并；不推送、不部署。
- 任务图：01 → 02/03/04 → 05，任务文件位于 [issues](issues/)。

## Decisions-so-far

- [01](issues/01-shared-contract.md) 已固定 URL 导入、个人连接器和共享快照协议；集成分支 `codex/lark-prd-import`。
- [ADR-0014](../../docs/adr/0014-personal-lark-prd-import.md) 记录个人本机 Lark 身份和单实例 VPS 的交互边界。
- [验证回执](integration-verification.md) 区分受控 Lark 子进程、真实 MySQL/页面和待取得的真实 Lark/VPS 证据。

## Fog

- 真实双成员电脑、真实 PRD 和 VPS 尚未取得验收证据。
- PRD 分析和测试用例生成保留为后续 TODO。
