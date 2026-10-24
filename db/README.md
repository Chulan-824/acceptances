# 归档数据库

日常开发与应用容器使用 MySQL。业务结构源为 [001_archive.sql](migrations/mysql/001_archive.sql)，完整二进制文件结构为 [002_files.sql](migrations/mysql/002_files.sql)，由 `embed.go` 随服务打包，`schema_migrations` 保存校验和与迁移状态。业务关系、字段和迁移方式见 [MySQL 存储](../docs/mysql-storage.md)。

SQLite v6 作为旧数据迁移源和默认隔离测试实现保留。迁移保留原报告、证据、评审、冻结档案与顺序，不删除源库。已有本地文件需显式迁移并完整回读后切换；切换后一个 MySQL 完整备份包含业务与文件，可在空本地目录重启。旧目录和 SQLite 保留，交付档案按现有保留规则独立于原始 Run。旧 PostgreSQL 数据不在此导入协议内。
