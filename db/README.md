# PostgreSQL 与迁移

使用 PostgreSQL 18.6、pgx v5.11.0、goose v3.28.0 和 sqlc v1.31.1。
编号 SQL 迁移嵌入 server 二进制；应用启动不自动迁移。显式执行 `server migrate up`，再 `server init-owner`；Docker 对应 `make docker-migrate` 和 `make docker-init-owner`。

`make generate` 生成 `internal/database/queries`，源为 `db/queries/control.sql` 与编号迁移。迁移使用 PostgreSQL session advisory lock。schema 不兼容、未初始化或维护期间 readiness 不通过。Down 迁移明确拒绝执行，不能把回滚当作重置数据。

关系和状态契约见 `.scratch/open-source-v1/specs/data-state.md`。本次尚待隔离 PostgreSQL 运行验证，详见 `docs/v1-implementation-handoff.md`。
