# 归档数据库

日常开发与应用容器使用 MySQL。业务结构源为 [001_archive.sql](migrations/mysql/001_archive.sql)，完整二进制文件结构为 [002_files.sql](migrations/mysql/002_files.sql)，由 `embed.go` 随服务打包，`schema_migrations` 保存校验和与迁移状态。业务关系、字段和迁移方式见 [MySQL 存储](../docs/mysql-storage.md)。

运行时、隔离测试和恢复均仅使用 MySQL。旧 MySQL 附件目录仍可显式迁入数据库并完整回读后切换；完整 MySQL 备份包含业务和全部文件，可在空本地目录重启。交付档案按现有保留规则独立于原始 Run。
