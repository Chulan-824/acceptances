# 02 服务端任务、快照与文件持久化

Type: task
Status: ready-for-agent
Blocked by: 01

完整范围见 [spec](../spec.md) 和 [接入合同](../implementation-contract.md)。实现所有连接器/任务/快照路由、追加迁移、本人执行和预览隔离、领取租约、结果与确认两阶段事务、幂等/版本/partial 补全、已有 MySQL 文件 owner、不可变保护、删除影响与恢复引用审计。沿既有边界组织职责，不复制 blob 写入器。

以公开 HTTP API + 隔离真实 MySQL 做 TDD。包含两用户读取任务隔离、共享确认、文件与状态一致性、重复与并发确认、取消/离线/过期和历史业务不变。不得用日常库。

## Comments
