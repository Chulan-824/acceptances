# Standards 审查

范围为 `3d4d8b8b97cc3dd0f2adbcb200e5264994b5a50f...2b4eeef`，56 个文件。核对 AGENTS.md、Campaign 后端样板、领域规则及相关 ADR、GLOSSARY.md、DESIGN.md、工具链和 issue tracker，并追查实际注册、认证、文件预览、存储审计和删除调用方。

## 硬性规范违反

未发现实质违反。PRD 复用现有连接池、共享锁、事务和 blob 封存/读取；本人任务及候选隔离与确认后共享均已接入真实路由。未将仅适用于原四个 Campaign 接口的 Gin 约束误套到 PRD。

## 判断性 smell

1. [P2] possible Mysterious Name：`internal/cli/lark_reader.go:168-169` 在 `markdown.RevisionID != xmlDoc.RevisionID` 时返回 `larkProblem("LARK_VERSION_CHANGED")`，`130` 行在重读仍不稳定时同样返回该码。这个名称没有指出变化的是 PRD 修订，已经在调用方产生语义错误：`apps/web/src/campaign-prd-controller.ts:57` 映射成“本机 Lark CLI 版本已变化，请重新启动连接器”。持续编辑 PRD 的用户会被误导去重启未变化的 CLI。最小修复是将文案改为文档版本不稳定、稍后重试，并补一条经 `prdErrorMessage` 或 controller 的行为断言；若改错误码，须同步 failure 白名单与测试。该项是 Fowler 命名启发式及已追踪到的用户影响，不冒称仓库硬性规则。

未报告跨语言 DTO、协议状态字符串或 Handler/Service/DAO 的必要转发为重复/中间层问题；它们符合本仓库职责与契约。

发现数量：硬性规范违反 0，possible smell 1。

本轮只读，未运行浏览器、测试、格式化或 lint，未修改源码及 Git；真实 Lark、多电脑、VPS 与其他 OS 的验收仍需外部回执。
