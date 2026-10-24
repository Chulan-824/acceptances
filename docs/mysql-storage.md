# MySQL 存储与保留数据迁移

日常开发使用宿主机 Go/Vite 与 Docker MySQL。应用容器部署使用 Go/Web 与 MySQL 两个服务。报告、评审、交付元数据及截图、视频、HTML 等完整文件字节统一保存在 MySQL。新建空归档直接使用数据库文件存储；已有附件目录必须执行文件迁移并通过回读校验后才切换。API、CLI 和人工评审规则保持兼容。

## 本地开发

先启动 Docker。首次安装依赖后运行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
make dev-up
make dev-status
```

Web 为 `http://127.0.0.1:5173`，API 为 `http://127.0.0.1:8765`。`make dev` 前台运行。开发入口自动启动 `acceptances-dev` Compose 项目的 MySQL，健康后连接 `127.0.0.1:3307/acceptances_dev`。数据库卷是 `acceptances-dev_mysql-data`，`.cache/dev-data` 仅用于定位待迁移的旧归档；切换完成后不再写入 SQLite 或本地附件。

`make dev-stop` 只停止 Go/Vite；`make mysql-stop` 停止数据库而保留卷；`make mysql-status` 查询数据库。不要使用 `down -v`。启动服务失败不会回退到 SQLite。

凭据由 `scripts/v1/mysql.mjs` 随机生成，存放在权限为 0700 的 `.cache/mysql` 目录。文件通过 Compose secrets 提供给容器，应用通过 `ACCEPTANCES_MYSQL_DSN_FILE` 读取连接配置，不打印连接串。容器中的应用使用数据库主机名 `mysql`。不要提交、展示或重新生成已有凭据；备份数据库时一并保管该目录。

## 现有开发数据迁移

先核对当前服务、监听端口和数据目录。使用本仓库入口停写，再迁移：

```sh
make dev-status
make dev-stop
make mysql-migrate
make dev-up
```

`ACCEPTANCES_DATA_DIR` 可以指定原数据目录。迁移源要求 SQLite v6，且 WAL 已由原服务正常关闭并检查点完成。旧于 v6 的库先在独立备份上用原服务升级，不对未知版本猜测字段。

迁移器先取得附件目录的进程锁，再以 SQLite EXCLUSIVE 模式锁住源库，拒绝仍打开源库的旧版连接。空 WAL 不能作为停机证明。源连接需有读写打开权限以取得排他锁，但迁移不执行源库数据写入；完整性检查、外键检查、逐表读取、文件备份、目标提交和目录绑定全程持锁，最后回滚只读事务并关闭源连接。未完成 checkpoint 的非空 WAL 仍拒绝迁移。

检查通过后将完整目录复制到 `<数据目录>/.backups/mysql-import-<时间>-<随机值>/data`。已有 `.backups` 不重复复制。`files.json` 记录逐文件大小和 SHA-256。

目标必须为空，或与这次源数据逐表完全一致。已启用 MySQL 文件存储的空归档拒绝只导入 SQLite 元数据；应在全新目标中先执行旧业务导入，再迁移文件。导入在一个 MySQL 事务中完成，核对全部原始字段和序列后才提交；不同数据拒绝覆盖。提交结果未知时重跑同一迁移，通过读取确认是否已提交。成功回执 `migration.json` 包含逐表行数、内容摘要和备份路径。原 `archive.db` 与附件不删除，旧人工判断不重置。

`.mysql-storage.json` 将附件目录绑定到 MySQL 归档的身份。必须与附件一起保管；连接其他归档、使用未绑定的非空目录或尝试把迁移后的目录重新作为 SQLite 启动均被拒绝。回退时恢复完整备份到独立目录，以 `--database=sqlite` 启动，不能让两种数据库同时写入同一附件目录。迁移后新增数据只进入 MySQL，旧 SQLite 不会同步更新。

绑定先写入同目录的私有临时文件，完成文件同步后，以不覆盖已有文件的原子链接发布并同步目录。短写失败不会留下截断的正式绑定，恢复空间后可重试；崩溃遗留的临时绑定不会用于识别归档。已有损坏或身份冲突的正式绑定仍拒绝启动，保留文件供人工核对，不能通过删除绑定绕过检查。

## 将现有文件迁入当前 MySQL

当前 MySQL 中的业务记录是迁移权威，**不要重新导入旧 SQLite**。旧 SQLite 已停止同步，重新导入会遗漏后续记录或与现有数据冲突。

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

迁移不会删除旧 `archive.db`、附件目录、既有备份。迁移后不能把旧目录当作最新备份恢复；后续新增内容全部在 MySQL。完整数据库备份已包含全部业务和文件，恢复到独立 MySQL 后可使用空本地目录启动。源目录中的历史绑定仍校验归档身份；空目录不要求绑定文件。恢复后需完整回读验证，再启用服务。回退只能停写后恢复迁移前完整 MySQL 和相应附件副本，不能仅切换配置。

## 应用容器

全新数据使用 `make docker-up`。原应用卷已有 SQLite 时先确认旧应用已停写并完成外部一致备份，然后运行：

```sh
make docker-migrate
make docker-up
```

`docker-migrate` 构建当前源码、启动 MySQL，并以一次性应用容器迁移 `acceptances_app-data`。旧导入入口先迁移业务数据；升级已有附件卷还需在停写和完成 MySQL 外部备份后，用一次性应用容器执行 `--database=mysql --migrate-files`。`acceptances_mysql-data` 保存业务和完整文件。旧附件卷保留供回退。运行中的应用持有归档租约，迁移器会拒绝同时接管它。

应用与开发服务默认都使用宿主机 8765，不能同时占用该端口。容器内 MySQL 不发布宿主机端口。保留应用卷、MySQL 卷及凭据，数据库备份与附件备份必须在应用停止写入期间配套完成，单独复制 MySQL 数据文件不能代替一致备份。

## 结构与事务

业务结构位于 `db/migrations/mysql/001_archive.sql`，文件结构位于 `002_files.sql`，随服务通过 `db/embed.go` 打包。11 张业务表沿用现有职责，另有 `schema_migrations` 保存版本、校验和、归档身份及 dirty 状态。MySQL DDL 会隐式提交，因此失败后保留 dirty 并拒绝启动，须核对已执行语句后人工恢复，不自动忽略或重跑部分结构。

UUID 与请求幂等键保持原值。数据库使用 InnoDB/utf8mb4，业务身份区分大小写。仓库来源全文保留，用 SHA-256 建唯一索引，读取时仍核对原文。六张依赖发布/追加顺序的表增加 `seq`；导入将旧 `rowid` 映射为 `seq`，相同时间戳的评审仍按保存顺序取判断。

报告、快照和指南原文使用 LONGTEXT。MySQL JSON 类型会规范化内容，不能用于保存按原文字节校验的快照。`created_at` 保留 RFC3339Nano 原文，`created_at_utc` 由插入触发器生成 DATETIME(6) 查询值，不反向改写原文。

来源 Project/Campaign/Run 可以删除，快照仅保留其历史 ID，不通过来源外键级联删除；快照子表使用限制删除的外键。不可变触发器继续保护快照、事件、成功文档及迁移/合并关系。本机 MySQL 开启 `log_bin_trust_function_creators` 以便数据库所有者创建这些触发器，不授予应用 SUPER 权限。

一个数据库只允许一个应用实例持有 MySQL 会话租约。SQLite、旧文件后端和迁移器还持有附件目录的操作系统排他锁，覆盖 macOS 本地开发与 Linux 容器。租约断开不会释放目录锁；服务关闭后，目录锁仍保留到最后一个在途请求完成文件清理，之后新实例才能执行恢复。进程退出由操作系统释放锁，不靠遗留 PID 文件判断占用。

失去租约后拒绝新请求，须关闭并重启服务。报告上传、冻结快照、文档版本预留和文档发布的事务在写入前及提交前再次核对租约。评审及相关父记录加锁。数据库提交超时后的文件归属使用锁定读取确认，无法确认时保留文件，等待恢复。

## 验证入口

```sh
make lint typecheck build
make test
make test SUITE=mysql
```

`mysql` 分组创建并清理随机 `acceptances_test_` 数据库，验证迁移、重试、原文与顺序、不变约束、删除保留、并发冻结及目录绑定，不覆盖日常数据库。故障回归实际断开租约连接、注入操作系统短写，并验证运行中及旧版 SQLite 连接拒绝迁移、迁移期间阻断写入、跨进程目录锁、在途关闭和重启重试。文件回归还覆盖分块边界、空文件、大小写文件名、去重、Range/HEAD、源文件损坏拒绝、预存引用重试及空目录重启。默认 Go 测试继续使用 SQLite，不能代替 MySQL 结果。

浏览器 MySQL 模式为每组分配独立数据库、临时附件目录和随机端口，回执记录 `databaseEngine`。真实 Go API 场景与受控 HTTP 场景仍分别标记；受控 HTTP 不能证明数据库行为。日常数据迁移还须独立核对原表摘要、附件及真实页面。
