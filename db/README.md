# 归档数据库

日常开发与应用容器使用 MySQL。结构源为 [001_archive.sql](migrations/mysql/001_archive.sql)，由 `embed.go` 随服务打包，`schema_migrations` 保存校验和与迁移状态。业务关系、字段和迁移方式见 [MySQL 存储](../docs/mysql-storage.md)。

SQLite v6 作为旧数据迁移源和默认隔离测试实现保留。迁移保留原报告、证据、评审、冻结档案与顺序，不删除源库。MySQL 的元数据与本地证据目录必须绑定、配套备份，交付档案按现有保留规则独立于原始 Run。旧 PostgreSQL 数据不在此导入协议内。
