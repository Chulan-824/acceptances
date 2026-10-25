# 正式交付与业务说明交接

> 存储更新（2026-10-25）：当前版本仅使用 MySQL。下文 SQLite 升级记录仅作历史说明，对应代码及入口已移除；当前验证命令与恢复约定以 [工具链](toolchain.md) 和 [MySQL 存储](mysql-storage.md) 为准。

2026-10-13，按用户确认及“后续待确认的都按照推荐先实现”的授权完成源码实现和平台隔离验证。未安装、升级日常服务、部署、提交或推送，未执行业务项目真实回归。产品规则见 [ADR-0005](adr/0005-freeze-current-traceable-run.md)、[ADR-0006](adr/0006-project-stable-feature-check-identities.md)、[ADR-0007](adr/0007-delivery-effects-and-retention.md)。

## 使用入口

1. 项目侧在真实报告发布前准备[正式交付材料](../skills/acceptances-v1/references/delivery.md)：需求、稳定身份地图、结构化说明素材、源码与真实构建清单及截图。通过原 CLI publish 上传平铺 evidence，不添加未知 Report 字段。
2. 人审接受最新完整 Run。从需求顶部点击“确认需求交付”，审阅来源、必验范围、素材与异常项的具体接受理由，明确勾选范围、素材及敏感信息确认。
3. 从交付详情生成业务说明，预览或下载独立版本的离线 HTML。审核撤回等变化使交付失效，原内容保留；再次人审接受仍须明确重新冻结。

验证记录页分开显示当前 Run 状态与该需求最近冻结版本，首页“交付版本”可打开来源已删除的快照。API 契约见 [contracts/delivery.md](../contracts/delivery.md)。

## 持久化与升级

库版本增至 3，新增独立快照、幂等请求、效力事件及文档版本表。对既有库在迁移前自动 `VACUUM INTO` 保存 `archive.before-v3.*.db`；原报告与逐项判断不重置。快照和事件的不可变字段由 SQLite trigger 保护，来源记录无级联外键。

文件目录新增 `deliveries/<id>/evidence/` 和 `documents/<id>/business.html`。冻结先复制并核对全部附件，再提交快照与事件；服务启动清理未提交目录，将中断的生成记录置失败。成功 HTML 和归档证据读取核对摘要。删除源记录保留独立材料与历史文档，未提供交付档案删除接口。

2026-10-18，文件发布与恢复集中到 `internal/api/delivery_artifacts.go`，两条发布入口位于 `delivery_files.go`。暂存、文件及目录同步、rename、数据库归属确认与失败清理由同一 module 管理。失败清理无法确认归属时保留文件；成功档案损坏仍在读取时报错，不自动重建。显式 retry 和同 requestId 重试均先清理 failed 版本残留，清理失败不消耗 attempts。

快照提交和文档生成占用使用 `delivery_transactions.go`，确保归属核对前事务已结束。针对当前 SQLite 驱动的 COMMIT 失败后连接可能仍保留事务的行为，保留并丢弃对应失败连接；连接级 foreign_keys/busy_timeout 在每次连接建立时设置。未改变数据库版本、归档目录或既有成功记录。

以后升级日常服务前，仍须按 [README](../README.md) 备份整个数据目录，数据库自动备份不包含附件。仓库 skill 已补材料契约，当前机器既有安装未替换；部署与 skill 替换需要后续明确安排。

## 验证证据与范围

平台 Go 测试覆盖冻结门槛、旧 token、重复/并发请求、事务失败、失效与替代、来源删除保留、迁移备份与重启、文档独立版本、摘要损坏、失败重试及输入转义。`make lint typecheck build` 检查前后端与构建。

文件协议回归新增同步/rename/清理失败、真实 SQLite 延迟约束导致的 COMMIT 失败、取消请求后的归属核对、两个重试入口、启动失败恢复及成功档案损坏保留。`delivery_crash_test.go` 让独立子进程通过回环 HTTP，在 stage 完成、rename 后及数据库成功后三个节点直接退出，再重新打开归档验证恢复和幂等；需要允许本地临时端口。这验证进程中断恢复，不等于物理断电验证。

[delivery-real.mjs](../apps/web/tests/delivery-real.mjs) 在独立临时 Go 服务与专用浏览器中验证真实冻结、生成、sandbox 预览、撤回失效、来源删除保留、窄屏和断网离线 HTML；合成数据均明确标注。既有刷新与定位回归使用受控 HTTP fixture，不能将其记作真实业务验证。

本地详细回执和截图位于 `.scratch/delivery-snapshot-business-doc/verification/`，该目录被 Git 忽略，不保证其他 checkout 存在。三轴审查的两个 P2 经独立确认、修复及针对性复验；完整结论在本地报告。平台通过不代表 cpp-admin-web 的候选场景、静态源码包或真实构建已验证。正式业务试跑仍需在业务侧准备实际材料和明确授权。
