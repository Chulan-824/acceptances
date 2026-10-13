# 正式交付与业务说明交接

2026-10-13，按用户确认及“后续待确认的都按照推荐先实现”的授权完成源码实现和平台隔离验证。未安装、升级日常服务、部署、提交或推送，未执行业务项目真实回归。产品规则见 [ADR-0005](adr/0005-freeze-current-traceable-run.md)、[ADR-0006](adr/0006-project-stable-feature-check-identities.md)、[ADR-0007](adr/0007-delivery-effects-and-retention.md)。

## 使用入口

1. 项目侧在真实报告发布前准备[正式交付材料](../skills/acceptances-v1/references/delivery.md)：需求、稳定身份地图、结构化说明素材、源码与真实构建清单及截图。通过原 CLI publish 上传平铺 evidence，不添加未知 Report 字段。
2. 人审接受最新完整 Run。点击“冻结正式交付”，审阅来源、必验范围、素材与异常项的具体接受理由，明确勾选范围、素材及敏感信息确认。
3. 从交付详情生成业务说明，预览或下载独立版本的离线 HTML。审核撤回等变化使交付失效，原内容保留；再次人审接受仍须明确重新冻结。

验证记录页分开显示当前 Run 状态与该需求最近冻结版本，首页“交付归档”可打开来源已删除的快照。API 契约见 [contracts/delivery.md](../contracts/delivery.md)。

## 持久化与升级

库版本增至 3，新增独立快照、幂等请求、效力事件及文档版本表。对既有库在迁移前自动 `VACUUM INTO` 保存 `archive.before-v3.*.db`；原报告与逐项判断不重置。快照和事件的不可变字段由 SQLite trigger 保护，来源记录无级联外键。

文件目录新增 `deliveries/<id>/evidence/` 和 `documents/<id>/business.html`。冻结先复制并核对全部附件，再提交快照与事件；服务启动清理未提交目录，将中断的生成记录置失败。成功 HTML 和归档证据读取核对摘要。删除源记录保留独立材料与历史文档，未提供交付档案删除接口。

以后升级日常服务前，仍须按 [README](../README.md) 备份整个数据目录，数据库自动备份不包含附件。仓库 skill 已补材料契约，当前机器既有安装未替换；部署与 skill 替换需要后续明确安排。

## 验证证据与范围

平台 Go 测试覆盖冻结门槛、旧 token、重复/并发请求、事务失败、失效与替代、来源删除保留、迁移备份与重启、文档独立版本、摘要损坏、失败重试及输入转义。`make lint typecheck build` 检查前后端与构建。

[delivery-real.mjs](../apps/web/tests/delivery-real.mjs) 在独立临时 Go 服务与专用浏览器中验证真实冻结、生成、sandbox 预览、撤回失效、来源删除保留、窄屏和断网离线 HTML；合成数据均明确标注。既有刷新与定位回归使用受控 HTTP fixture，不能将其记作真实业务验证。

本地详细回执和截图位于 `.scratch/delivery-snapshot-business-doc/verification/`，该目录被 Git 忽略，不保证其他 checkout 存在。三轴审查的两个 P2 经独立确认、修复及针对性复验；完整结论在本地报告。平台通过不代表 cpp-admin-web 的候选场景、静态源码包或真实构建已验证。正式业务试跑仍需在业务侧准备实际材料和明确授权。
