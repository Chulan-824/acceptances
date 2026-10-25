# Lark PRD 集成验证

## TDD 证据

- 基线：`4130d0e`，新增 `internal/api/prd_connector_integration_test.go`。
- 2026-10-25：公开 CLI 进程 + 真实 HTTP + 独立 MySQL 测试库的完整用例先失败：`TestPRDLocalConnectorPublishesForItsOwnUser`，4.30 秒，连接器退出码 1。此时服务端 PRD 路由和连接器命令尚未合并。
- 测试使用受控外部 `lark-cli` 可执行文件，仅证明平台与本机连接器协议；不证明真实 Lark 权限、成员电脑或 VPS 生产链路。

## 待完成

- 合并服务端、CLI 和 Web 后运行完整用例。
- 静态检查、相关测试、构建和真实页面验证。
- Standards / Spec 独立审查及实质问题修复。
- 真实双成员电脑、真实 PRD、VPS 和其他操作系统需外部验收。
