# Lark PRD 导入实施地图

## Notes

- 设计：[spec](spec.md)，共享协议：[implementation-contract](implementation-contract.md)。
- 用户已授权开发及任务相关本地提交/合并；不推送、不部署。
- 任务图：01 → 02/03/04 → 05，任务文件位于 [issues](issues/)。

## Decisions-so-far

- [01](issues/01-shared-contract.md) 已固定 URL 导入、个人连接器和共享快照协议；集成分支 `codex/lark-prd-import`。
- [02](issues/02-server.md) 已合入任务、共享快照与 MySQL 文件归属，公开 HTTP 行为和故障注入通过；完整集成和备份恢复由 05 继续。
- [03](issues/03-local-connector.md) 已合入个人本机连接器和共享内容校验；关键并发 race 与 agent 检查通过。
- [04](issues/04-web.md) 已合入网页导入与版本阅读；125 项 Web 测试、类型和构建通过，真实页面另由 05 验证。
- [ADR-0014](../../docs/adr/0014-personal-lark-prd-import.md) 记录个人本机 Lark 身份和单实例 VPS 的交互边界。
- [验证回执](integration-verification.md) 区分受控 Lark 子进程、真实 MySQL/页面和待取得的真实 Lark/VPS 证据。

## Fog

- 真实双成员电脑、真实 PRD 和 VPS 尚未取得验收证据。
- PRD 分析和测试用例生成保留为后续 TODO。
