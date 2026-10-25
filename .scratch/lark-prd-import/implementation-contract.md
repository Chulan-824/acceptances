# 实现协作合同

基线：3d4d8b8，集成分支 codex/lark-prd-import。唯一设计来源为 [spec](spec.md)，共享 Go DTO 在 internal/prd/types.go。用户已确认测试边界，并授权任务相关本地提交与合并，未授权推送、部署或操作日常报告。

## 前沿与归属

- 01 为共享类型与本合同；02 服务端、03 CLI、04 Web 可并行；05 依赖 02/03/04。
- 每个实现者使用自己的工作树与分支，基于集成分支；先 TDD 失败再实现，合并最新集成分支后报告。
- 02 负责 db/migrations、internal/api|handler|service|dao|model 的 PRD 接入，不修改 internal/prd 的共享算法或 Web/CLI。
- 03 负责 internal/cli、internal/prd 除已固定 types.go 之外的 URL/内容校验/规范化与抓取适配。需要修改 DTO 先向主 Agent 说明。
- 04 负责 apps/web 与 packages/api-client，不修改 Go。
- 05 由主 Agent 负责集成、仓库文档、验证与审查；任务状态在各 issues 文件内更新。

## 服务端与 CLI 共享合同

- Connector 注册响应为 Registration，即 connector 与只返给该进程的 connectorToken。所有连接器调用仍须当前平台 Bearer，会话过期必须拒绝。
- X-Acceptances-Connector-Token 用于证明指定连接器；result/failure 另用 X-Acceptances-Claim-Token 和 X-Acceptances-Claim-Attempt。值不能记录到日志。
- poll 请求正文为可选 importId、attempt、claimToken。空闲可传空对象，返回 204 或 Claim；忙碌时用于续租，返回同一 Claim。任务已取消/过期返回 409，让本机取消当前子进程；认证过期停止整个连接器。
- result 使用 multipart：manifest 为 JSON 字段，各文件使用 file 字段，filename 等于 manifest.files[].name。source.json 和 document.md 必须存在，资源一层文件名。
- failure 正文为 errorCode、phase、retryable；领取凭据放上述请求头。
- create import 请求为 url、connectorId、clientRequestId；返回 Import，含 baseSnapshotId，供确认时 expectedCurrentSnapshotId 使用。
- confirm 响应统一为 Snapshot；重复确认/内容去重返回 200，新快照返回 201。Import.confirmedSnapshotId 指向实际复用或新建的快照。
- SnapshotList 为 currentSnapshotId 与 items。Snapshot 内嵌 manifest；原始正文和资源通过文件路由加载，不内嵌到列表。
- 安全任务错误使用固定 errorCode，正文原始错误、身份材料、认证 URL 不上送服务器。

## 共享算法的 Go 接口

由 03 实现，02 可按以下调用编写代码。类型定义已在 types.go。

- NormalizeURL(raw string) (SourceURL, error)：受限 HTTPS Docx/Wiki URL，规范化 query/fragment 与 realm/token。
- ValidateBundle(manifest Manifest, files map[string][]byte) (Bundle, error)：重算文件摘要、验证大小/MIME/资源对应/完整性/结构安全与源版本；输出稳定 SourceHash、ResourceHash。失败不返回可持久化 Bundle。
- SourceDocument 是已经剔除评论与临时 URL 的结构副本，字段使用项目 camelCase。source.json 不是未经筛选的 Lark 响应。
- NormalizerVersion 固定语言 zh-CN；Manifest.warnings/resources/files 成功返回时使用空数组，不使用 null。

## 验证边界

只使用临时测试账号、Campaign、隔离 MySQL。不得读取 .env*，不得启动 Playwright 或重启日常服务。真实 PRD/VPS/多电脑验收仍是未取得的外部证据，所有回执区分静态、受控外部子进程和真实环境。
