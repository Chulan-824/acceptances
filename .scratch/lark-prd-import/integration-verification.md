# Lark PRD 集成验证

2026-10-26，本机 `darwin/arm64`。任务基线 `3d4d8b8b97cc3dd0f2adbcb200e5264994b5a50f`，集成分支 `codex/lark-prd-import`。用户授权本地开发、提交和合并；未推送、部署、替换日常 CLI 或重启日常服务，未读取 `.env*` 或操作日常报告。

## 实现与证据来源

- [设计](spec.md)、[接口合同](../../contracts/lark-prd.md)、[ADR](../../docs/adr/0014-personal-lark-prd-import.md)。
- 服务端 `ca1f592`，CLI `159e675`，共享算法补充 `74472c2`，Web `b2aa3eb`，删除展示补充 `47c169e`，均经独立 merger 合入。
- [服务端回执](server-verification.md)、[连接器回执](connector-verification.md)、[Web 回执](web-verification.md)、[删除展示回执](web-deletion-verification.md)。
- 原始命令日志、截图、恢复摘要与本轮浏览器 harness 位于 `artifacts/lark-prd-import-20261025/`。目录日期是任务开始日；浏览器和最终整合发生于本地 10 月 26 日。

## 完整链路的红绿证据

基线 `4130d0e` 新增公开用例 `internal/api/prd_connector_integration_test.go`。服务端和 CLI 尚未合入时，`TestPRDLocalConnectorPublishesForItsOwnUser` 先失败，4.30 秒，连接器退出码 1。

集成 `2b4eeef` 后，同一用例通过，22.616 秒。它从独立 OS 进程调用公开 CLI，在无 Git 仓库的临时目录登录平台、启动连接器，使用 PATH 上受控的外部 `lark-cli`，经真实 HTTP 和独立 MySQL 库完成领取、全文/同修订读取、图片回传、候选隔离及确认共享。第二用户能在确认后读取正文，Campaign 保持 pending 且无 Run。

受控外部命令使用已查证的 1.0.98 公开输出形状。这里的“完整链路”是本机平台与连接器的工程闭环，不能证明真实 Lark 权限、两台成员电脑或 VPS 网络已验收。

## 项目检查

以下在干净的 `2b4eeef` 执行，通过后才进入审查修正。后续修正的回归单独记载，不将这轮结果冒称为未知后续提交的全库重跑。

| 命令 | 实际结果 |
| --- | --- |
| `make fmt` | 通过，无新增格式差异 |
| `make lint typecheck build` | 全部退出 0；Vite 保留大于 500 kB 的资源块提示 |
| 定向公开完整链路用例 | 通过，22.616 秒 |
| `make test` | 全部通过：Web 127、生命周期 11、检查脚本 17；Go API 502.467 秒、CLI 71.129 秒，其余包通过 |
| `make check-extra BASE=3d4d8b8b97cc3dd0f2adbcb200e5264994b5a50f` | 通过，agent=true、jev=false；安装器 1、Jev 离线 7、CLI 71.182 秒 |

完整测试使用入口创建的专用 MySQL 库；没有运行 Playwright、发布镜像或真实模型。连接器实现者另有通过的关键并发 race 选择范围，详见其回执；延长 fixture 等待阈值后未重跑完整 race 全集。

## 真实浏览器与原生进程

使用 `ego-browser` 技能与真实浏览器空间 4，专用合成账号 `prd_browser_first` / `prd_browser_second`、项目与 Campaign；平台使用新构建原生服务和专用 MySQL 库，Lark 使用受控外部进程。原始服务端口 57221，恢复后端口 59376，均为回环随机端口。

实际验证：

1. 首次未勾选共享规则时“读取文档”禁用；唯一的本人连接器自动选中。输入带 query/fragment 的 URL 后自动读取，待确认显示规范化原文链接、修订 42 和 1/1 资源。
2. 正文预览显示两行表格，单元格顺序正确；正文和资源清单引用同一张图片，图片请求成功且 naturalWidth=1。首次自动化断言误把 DOM 图片数量当成资源数量，观察后改按唯一资源地址与加载状态核对，未修改产品代码。
3. 甲退出网页、乙登录后，甲的任务与候选文件均返回 404，乙没有甲的连接器，也看不到未确认快照。
4. 甲重新登录能恢复原候选；确认后出现当前版本、确认人和读取时间，Campaign 仍为整体待评审，运行记录 0。
5. 相同修订重新读取、确认后提示“内容未变化，已复用现有共享快照”，列表仍只有 1 个正式快照。
6. 甲在网页主动断开本轮连接器，乙仍能阅读已确认正文和图片；读取路径为共享快照路由。
7. 删除影响弹窗明确显示 1 个 PRD 版本、6 个 PRD 文件引用（两次读取各 3 个文件）；点击取消，没有执行删除。
8. 恢复到全新数据库后，乙在新原生服务端口重新打开需求，正文、表格、图片及原确认人仍正确。

本轮构建身份为 `2b4eeef`、dirty=false，源码摘要 `dec6e85939d2089ff0cf870cf4f5938baaafc4ad0806f915a4e4a356a84801b7`。真实 DOM/截图不等于真实 Lark 原文比对；未在本轮 DOM 验证 partial/故障全部分支，它们由公开 HTTP、CLI 和 Web 状态测试覆盖。

截图：`candidate-preview.png`、`confirmed-snapshot.png`、`shared-reading.png`、`deletion-preview.png`、`restored-reading.png`。已视觉检查正文、主页面和删除弹窗。浏览器空间已 finish；两个随机端口均确认释放，本轮受管服务记录已回收，专用数据库由 harness 回收，原有 dev 服务保留。

## 真实 MySQL 备份恢复

停止本轮连接器和原生服务后，通过 `mysqldump --single-transaction --set-gtid-purged=OFF` 读取专用验收库，导入另一新建专用库，在全新数据目录启动原生服务。dump 只在进程内传输，没有归档凭据或 SQL 内容。

恢复前后快照列表元数据逐字节相同；对公开文件路由重新读取的 SHA-256 逐项相同：

| 文件 | SHA-256 |
| --- | --- |
| resource-001.png | 7ac2abfce2be8b46dd9826d597d94edeefc1570b4a992622721b90a1850e3ee9 |
| source.json | c561f06ba7bd1abfc6dad676c91eaec3bab17ebc96fe6ecf4e707d96ccde90cd |
| document.md | e75f332c4887ccaff13ab6558e7f33a5a3e650f15ec172f14b4e4552b765ab06 |

机读摘要为 `restore.json`。服务端独立测试另外覆盖事务回滚、同一资源多处引用变动拒绝、候选过期、SQL 不可变约束及删除引用审计。

## 独立审查

审查范围 `3d4d8b8...2b4eeef`。

### Standards

[原始报告](review-standards.md)：硬性违反 0，判断性 smell 1。最高问题是错误码语义误导：PRD 修订不稳定被提示成 CLI 版本变化。

### Spec

[原始报告](review-spec.md)：发现 2。最高问题是将上游最小限流等待截到 60 秒；另一项是上述文案问题。未发现实质范围扩张。

Standards 共 1 个判断性发现；Spec 共 2 个发现。两轴分开保留，没有把重复文案发现合计为第三个独立缺陷。

两个问题由同一实现者提交 `90da732`，通过独立 merger 合入 `f876485`。修正不再截短秒数或 HTTP-date 等待，处理 duration/jitter 溢出；同一字段适用于可重试 network 错误，也同步处理。错误提示改为等待 PRD 原文稳定后重试，没有改错误码或服务端白名单。

[修复回执](review-fixes.md)记录公开 CLI 的长等待红绿：旧版约 60 秒提前重发，修正后实际等待 120 秒才重试；HTTP-date、超大等待及信号取消均通过。首轮相关组 132.453 秒，带时间戳的回归 124.362 秒；短限流/断链、取消与真正 CLI 不支持场景 25.571 秒。没有用测试时钟缩短生产等待。

两名原审查者各自只读复查后均关闭原发现，新发现 0。根集成 `f876485` 再次通过 lint、类型、Web 128 项及完整公开链路 23.939 秒；未因只修改 CLI/Web 而重复 8 分钟的 API 全库测试。

根 Agent 额外复核了同步恢复请求与租约的交互：续租调用已有 deadline，实际缺口在 `candidateReady(ctx)` 遇长限流时可阻塞主循环，延迟处理租约 timer。同一实现者提交 `86b8efb`，由独立 merger 合入 `1ffaa70`，改由租约到期直接取消任务上下文。[修复回执](lease-fix.md)记录短租约公开 CLI 的 RED→GREEN；最终 fixture 的普通测试 8.378 秒、race 单项 35.334 秒通过。首次 race 组因 fixture 从子进程启动前计五秒而未进入目标恢复请求，总结果失败；改为读取后的续租给五秒，生产时限未改。已有 ready 竞争及取消清理子项通过，未将失败组记为全绿。

集成 `1ffaa70` 的公开完整链路 23.697 秒、`make lint typecheck` 均通过。[Standards 短复核](lease-standards-recheck.md)新增硬性违反及 smell 均为 0；[Spec 短复核](lease-spec-recheck.md)另发现 1 项 P2：旧 AfterFunc 回调已启动时，Reset 不能阻止它取消新续租。该项由同一实现者在 `0822502` 修复，独立 merger 合入 `754210d`，续租更新与回调到期判断共用同一锁。短标准库实验只证明定时器调度交错，没有冒充项目完整链路复现。

[竞态修复回执](lease-race-fix.md)记录普通三项 45.784 秒及 race 三项 90.264 秒全部通过，无数据竞争报告。标准库确定性交错实验验证旧回调读到新期限后不取消，当前期限到达后才取消。最后的 [Standards](lease-final-standards-review.md) 与 [Spec](lease-final-spec-review.md) 复核均无未关闭项；合并后文件 blob 与两名审查者记录的 `9092601e52766d453393d49bd746a03ba491358a` 一致。

根集成 `754210d` 的 `make lint typecheck` 和公开完整链路再次通过，完整链路 20.479 秒，日志为 `coordination-final-static.log`、`connector-roundtrip-coordination-final.log`。最后修正只触及 CLI，未重复 API 全库或真实 DOM，也未将旧的浏览器构建身份改写为新提交。最终文档提交后的干净构建身份及产物摘要另存 `artifacts/lark-prd-import-20261025/final-build.json`。

## 实施收尾

任务 01–05 均已解决，保留集成分支。Web 实施工作树已由桌面工具归档；服务端和连接器工作树的归档被工具拒绝，原因是“Another active task still uses this worktree.”。两处完整保留，不通过 shell 绕过保护；所需回执及日志已复制至本仓库。

## 未取得的验收证据

真实 Lark PRD 原文逐项比对、两个成员各自电脑与个人权限、VPS HTTPS 网络、真实睡眠/唤醒和撤权、目标 OS/架构、Docker 发布及生产备份演练均未运行。非 Unix 当前仅取消直接子进程，未保证子进程树退出。详见 [ready-for-human 交接](external-acceptance.md)。

PRD 分析和测试用例生成仍为 TODO。日常 API/CLI 未替换；源码与本地构建完成不表示日常入口已经加载新版。
