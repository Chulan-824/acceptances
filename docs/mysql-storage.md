# MySQL 存储与保留数据迁移

日常开发使用宿主机 Go/Vite 与 Docker MySQL。应用容器部署使用 Go/Web 与 MySQL 两个服务。报告、评审、交付元数据及截图、视频、HTML 等完整文件字节统一保存在 MySQL。新建空归档直接使用数据库文件存储；已有附件目录必须执行文件迁移并通过回读校验后才切换。API、CLI 和人工评审规则保持兼容。

## 本地开发

先启动 Docker。首次安装依赖后运行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
make dev-up
make dev-status
```

Web 为 `http://127.0.0.1:5173`，API 为 `http://127.0.0.1:8765`。`make dev` 前台运行。开发入口自动启动 `acceptances-dev` Compose 项目的 MySQL，健康后连接 `127.0.0.1:3307/acceptances_dev`。数据库卷是 `acceptances-dev_mysql-data`，`.cache/dev-data` 仅用于定位待迁移的旧归档；切换完成后不再写入本地附件。

`make dev-stop` 只停止 Go/Vite；`make mysql-stop` 停止数据库而保留卷；`make mysql-status` 查询数据库。不要使用 `down -v`。启动服务失败不会回退到其他数据库。

凭据由 `scripts/v1/mysql.mjs` 随机生成，存放在权限为 0700 的 `.cache/mysql` 目录。文件通过 Compose secrets 提供给容器，应用通过 `ACCEPTANCES_MYSQL_DSN_FILE` 读取连接配置，不打印连接串。容器中的应用使用数据库主机名 `mysql`。不要提交、展示或重新生成已有凭据；备份数据库时一并保管该目录。

## 数据库与恢复约定

当前版本仅支持 MySQL。未配置连接信息时启动失败，不创建本地数据库，也不提供旧 SQLite 启动、升级或导入命令。旧存储方案见历史 ADR；恢复只使用已经验证的完整 MySQL 备份。

保留 `.cache/mysql` 凭据、MySQL 数据卷和必要的 `.sql` 一致性备份。删除旧本地数据前，将完整备份恢复到独立测试数据库，逐表核对校验和及文件读取；不要覆盖日常数据库。历史备份不是当前数据源，不能用旧数据重新覆盖当前 MySQL。

`.mysql-storage.json` 将旧附件目录绑定到 MySQL 归档身份。旧 MySQL 文件后端仍校验该绑定，损坏或身份冲突时拒绝启动。绑定原子发布及目录锁机制继续保留，不能通过删除绑定绕过检查。

## 将现有文件迁入当前 MySQL

此入口只迁移已经使用 MySQL 的旧附件目录，不导入其他数据库的业务记录。

```sh
make dev-stop
make mysql-files-migrate
make dev-up
```

入口先将完整 MySQL（含触发器、存储过程及二进制数据）导出到 `.cache/backups/mysql-before-files-<时间>.sql`，再启动 `server --database=mysql --migrate-files`。文件迁移器取得目录锁和 MySQL 会话租约；核对全部 Run、冻结快照和成功文档的文件声明，拒绝缺失文件、额外文件、符号链接及哈希不符的冻结文件。完整源目录另存到 `.backups/mysql-import-*/data`，原 `.backups` 保留且不重复复制。

新表位于 [002_files.sql](../db/migrations/mysql/002_files.sql)：

| 表                     | 主键与职责                                                          |
| ---------------------- | ------------------------------------------------------------------- |
| `archive_blobs`        | 自增 `BIGINT UNSIGNED id`；完整 SHA-256 唯一，封存后不可变          |
| `archive_blob_chunks`  | `(blob_id, chunk_no)`；1 MiB 二进制分块及分块 SHA-256，空文件无分块 |
| `run_files`            | `(run_id, filename)`；原 Run 的文件引用，随 Run 级联删除            |
| `delivery_files`       | `(delivery_id, filename)`；独立冻结引用，来源 Run 删除后保留        |
| `document_files`       | `document_id`；成功文档关联完整 `business.html` 内容                |
| `archive_file_imports` | UUID；源清单、11 张业务表摘要、备份目录、校验计数和迁移状态         |
| `archive_file_storage` | 单例主键 `1`；文件后端、当前迁移批次及切换代数                      |

引用指向已封存对象，外键限制误删。同内容的多个文件和冻结引用共享一个对象，文件名仍区分大小写。视频、截图和文档使用相同的二进制存储协议，不使用路径代替实际内容。1 MiB 分块避免单条大 BLOB 受网络包大小限制。对象内容发布前完整回读 SHA-256；Run、冻结引用和文档成功状态分别在一个业务事务内发布。读取提供 Seek/HEAD/Range，逐块验证哈希，整个下载持有同一个只读事务快照。

迁移可以重跑：完全一致的引用跳过，差异拒绝覆盖。全部文件回读验证后，再核对源文件与 11 张业务表摘要没有变化，最后一个事务同时记录校验结果、激活批次和文件后端。激活前仍读旧目录，激活后只读写 MySQL。错误不触发静默回退。提交结果未知时保留对象，重跑读取状态确认；未引用的封存对象保守保留，本版本不自动回收。

文件迁移不会删除源附件目录或既有备份。迁移后不能把旧目录当作最新备份恢复；后续新增内容全部在 MySQL。完整数据库备份已包含全部业务和文件，恢复到独立 MySQL 后可使用空本地目录启动。源目录中的历史绑定仍校验归档身份；空目录不要求绑定文件。恢复后需完整回读验证，再启用服务。回退只能停写后恢复迁移前完整 MySQL 和相应附件副本，不能仅切换配置。

## 应用容器

使用 `make docker-up` 启动 MySQL 应用。`acceptances_mysql-data` 保存业务和完整文件；`acceptances_app-data` 仅供旧 MySQL 附件导入兼容。升级已有 MySQL 附件卷时，在停写和完成外部一致备份后执行 `--database=mysql --migrate-files`。运行中的应用持有归档租约，文件迁移器会拒绝同时接管它。

应用与开发服务默认都使用宿主机 8765，不能同时占用该端口。容器内 MySQL 不发布宿主机端口。保留应用卷、MySQL 卷及凭据，数据库备份与附件备份必须在应用停止写入期间配套完成，单独复制 MySQL 数据文件不能代替一致备份。

## 结构与事务

业务结构位于 `db/migrations/mysql/001_archive.sql`，文件结构位于 `002_files.sql`，随服务通过 `db/embed.go` 打包。11 张业务表沿用现有职责，另有 `schema_migrations` 保存版本、校验和、归档身份及 dirty 状态。MySQL DDL 会隐式提交，因此失败后保留 dirty 并拒绝启动，须核对已执行语句后人工恢复，不自动忽略或重跑部分结构。

UUID 与请求幂等键保持原值。数据库使用 InnoDB/utf8mb4，业务身份区分大小写。仓库来源全文保留，用 SHA-256 建唯一索引，读取时仍核对原文。六张依赖发布/追加顺序的表使用 `seq`；相同时间戳的评审仍按保存顺序取判断。

报告、快照和指南原文使用 LONGTEXT。MySQL JSON 类型会规范化内容，不能用于保存按原文字节校验的快照。`created_at` 保留 RFC3339Nano 原文，`created_at_utc` 由插入触发器生成 DATETIME(6) 查询值，不反向改写原文。

来源 Project/Campaign/Run 可以删除，快照仅保留其历史 ID，不通过来源外键级联删除；快照子表使用限制删除的外键。不可变触发器继续保护快照、事件、成功文档及迁移/合并关系。本机 MySQL 开启 `log_bin_trust_function_creators` 以便数据库所有者创建这些触发器，不授予应用 SUPER 权限。

一个数据库只允许一个应用实例持有 MySQL 会话租约。旧 MySQL 文件后端和文件迁移器还持有附件目录的操作系统排他锁，覆盖 macOS 本地开发与 Linux 容器。租约断开不会释放目录锁；服务关闭后，目录锁仍保留到最后一个在途请求完成文件清理，之后新实例才能执行恢复。进程退出由操作系统释放锁，不靠遗留 PID 文件判断占用。

失去租约后拒绝新请求，须关闭并重启服务。报告上传、冻结快照、文档版本预留和文档发布的事务在写入前及提交前再次核对租约。评审及相关父记录加锁。数据库提交超时后的文件归属使用锁定读取确认，无法确认时保留文件，等待恢复。

## 验证入口

```sh
make lint typecheck build
make test
make test SUITE=mysql
```

`make test`、`SUITE=http` 和 `SUITE=mysql` 均使用随机 `acceptances_test_` MySQL 数据库，测试结束只清理本次创建的数据库，不覆盖日常数据。没有测试连接配置时数据库测试明确失败，不跳过或切换其他实现。HTTP、DAO、冻结、评审、删除保留、租约与恢复场景使用真实 MySQL；文件回归还覆盖分块边界、空文件、大小写文件名、去重、Range/HEAD、源文件损坏拒绝、预存引用重试及空目录重启。

浏览器 MySQL 模式为每组分配独立数据库、临时附件目录和随机端口，回执记录 `databaseEngine`。真实 Go API 场景与受控 HTTP 场景仍分别标记；受控 HTTP 不能证明数据库行为。日常数据迁移还须独立核对原表摘要、附件及真实页面。
