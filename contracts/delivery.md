# 交付快照与业务说明 API

与原报告归档 API 共用 /api/v1 和本机 Host/Origin 限制，无新增账号或身份隔离。Report schema 保持不变；素材作为平铺 evidence 随真实 Run 发布，格式以[正式交付材料](../skills/acceptances-v1/references/delivery.md)为唯一说明来源。

## 准备与明确冻结

| 方法与路径                               | 输入或结果                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET /campaigns/{id}/delivery             | 需求级概览：最新报告准备条件、当前有效交付、最近交付及其最近说明版本，独立于选中的历史报告        |
| GET /runs/{id}/delivery-preparation      | eligible、token、issues、Project/Campaign/Run、manifest/map/materials、附件摘要及可沿用的异常理由 |
| POST /runs/{id}/deliveries               | requestId、token、mapConfirmed、materialsConfirmed、sensitiveInfoReviewed、exceptionReasons       |
| GET /deliveries                          | 返回摘要 items，可按 projectId/campaignId/runId 查询，包括来源删除后的归档                        |
| GET /deliveries/{id}                     | 快照内容、当前效力、事件及 sourceRunAvailable                                                     |
| GET /deliveries/{id}/download            | 下载快照内容和当前效力记录 JSON                                                                   |
| GET /deliveries/{id}/evidence/{filename} | 读取独立证据副本，download=1 强制下载                                                             |
| POST /deliveries/{id}/revoke             | reason 必填，撤销但不删除原快照                                                                   |

准备 GET 只诊断，不改变人审或产生快照。issues 含 code/message；异常理由可在确认中补填，原批量人工通过文字不算具体理由。

冻结要求当前 latest、full、非 void、全项人工接受；源码完整提交、dirty=false，构建/素材与附件摘要一致，最终 Run 覆盖地图所有必验项且预期一致。用户须明确确认范围、说明内容、敏感信息审核及异常接受理由。

token 绑定准备时的人审、版本、附件字节及当前需求最新关系。陈旧 token 返回 409 STALE_DELIVERY_CONFIRMATION；条件不足返回 409 DELIVERY_NOT_READY 和 issues，确认或理由不完整返回 400。不存在返回 404，保存失败返回 500，不展示半成品。

requestId 全局唯一，同标识同内容返回原快照 200，异内容返回 409 FREEZE_REQUEST_CONFLICT。首次创建 201。同一有效 Run 与完全相同冻结内容的新标识也复用已有快照，并记录重试别名。对已失效快照重新明确冻结产生新版本；旧内容不改写。请求重放可读原快照当前效力，不使其重新有效。

快照 payload 及 sha256 固定，包含原报告、确认时人审历史与当前判断、清单/地图/素材、附件摘要、异常理由和确认记录。效力 status 单独为 valid、invalidated、revoked 或 superseded；事件追加时间、原因和关联记录，新交付通过 successorId 关联被替代版本。

对绑定 Run 的 rejected/pending、作废及来源删除，在同一事务中使交付失效。重新接受不自动恢复。新 Run 仍独立待审，不自动失效旧版本；新的明确冻结替代同 Campaign 当前有效交付。交付档案不可通过 API 删除。

删除预览新增 retainedDeliveries/retainedDocuments，明确保留数量。原 Project/Campaign/Run 及其附件仍删除，但交付复制证据和文档独立保留，来源不可读时返回 sourceRunAvailable=false。

## 独立说明版本

| 方法与路径                      | 输入或结果                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| GET /deliveries/{id}/documents  | 说明版本 items，按 version 倒序                                                                    |
| POST /deliveries/{id}/documents | requestId，按冻结材料生成                                                                          |
| GET /documents/{id}             | id/deliveryId/version/requestId/templateVersion/status/attempts/error/sha256/createdAt/completedAt |
| POST /documents/{id}/retry      | 空对象，失败版本原地重试生成状态，不增加 version                                                   |
| GET /documents/{id}/html        | 成品预览，download=1 下载离线 HTML                                                                 |

同 requestId 生成成功返回既有版本 200；同标识用于其他交付返回 409 DOCUMENT_REQUEST_CONFLICT。失败重试保留 id/version，attempts 增加。新的明确 requestId 创建新版本。成功版本不重写。生成中重复操作返回 409 DOCUMENT_GENERATING，不引入队列。

生成在请求内执行。status 先持久保存 generating，再生成临时文件，成品同步保存完成才变 succeeded 并返回 201。可处理的渲染失败返回 200 的 failed 记录及 error；生成状态自身保存失败为 500，客户端需重新读取确认。服务重启将中断 generating 标成 failed，清理临时文件，允许重试。

仅 valid 快照允许新生成或失败重试，失效/撤销/替代返回 409 DELIVERY_INACTIVE。已成功说明继续可作为历史预览和下载；未成功的 HTML 返回 409 DOCUMENT_NOT_READY。文件摘要不匹配返回 500 DOCUMENT_INTEGRITY_FAILED。

HTML 由固定模板和转义后的纯文本生成，只内嵌实际栅格图片，带来源摘要，没有外部脚本、字体或 CDN。HTTP 设置 nosniff 与 sandbox CSP，Web 用无许可 sandbox iframe 预览。离线文件不会随后续改判自动更新，当前交付效力以平台为准。

## 持久化与迁移

数据库版本增至 3，既有当前版本 2 人审保持不变。迁移前以 VACUUM INTO 保存 archive.before-v3.*.db 一致备份。旧版逐项人审迁移规则仍单独适用，不将历史整轮决定推断为新冻结交付。

交付副本位于 deliveries/<id>/evidence，说明成品位于 documents/<id>/business.html。交付表不依赖来源记录的级联删除；数据库触发器保护冻结内容、事件及成功说明状态。数据库决定可见性，启动清理无归属目录及中断临时产物。

## Web 入口与状态

需求顶部展示交付准备、阻塞原因及下一步。完整范围评审、本轮人工验收、交付版本和业务说明分别表达；本轮批量操作使用“全部人工通过”，完成后显示“本轮已验收”。“查看交付准备”允许未满足条件的报告进入审阅，最终“确认交付并保存快照”仍须满足全部既有门槛。

需求级概览复用冻结准备校验，只读取 campaign.latest_run_id，不回退历史报告。人工评审、作废、删除和刷新报告后并行回读概览；概览读取失败单独提示，不映射为尚未交付，也不延长本轮审核锁。概览同时保留当前有效交付与最新报告的独立进度；最新说明始终关联所展示的交付版本。无最新报告时 preparation=null，已冻结历史继续可读。
