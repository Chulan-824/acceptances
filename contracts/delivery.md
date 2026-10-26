# 交付快照、业务指南与测试报告 API

与原报告归档 API 共用 /api/v1、账号会话及 Host/Origin 校验。包括独立快照、附件和文档下载在内的业务路由均要求登录；当前所有登录用户共享访问与操作能力。Report schema 保持不变；素材作为平铺 evidence 随真实 Run 发布，冻结材料格式见[正式交付材料](../skills/Acceptances-Cl/references/delivery.md)。业务指南的独立文稿见下文。

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

## 独立文档版本

| 方法与路径                                    | 输入或结果                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET /deliveries/{id}/documents                | 文档 items，可按 kind=business_guide 或 test_report 过滤，按创建时间和版本倒序                          |
| POST /deliveries/{id}/documents               | requestId、kind、可选 guide；kind 省略兼容原接口，生成 test_report                                      |
| GET /documents/{id}                           | kind/id/deliveryId/version/requestId/templateVersion/status/attempts/error/sha256/createdAt/completedAt |
| POST /documents/{id}/retry                    | 空对象，失败版本原地重试，保留原内容与 version                                                          |
| GET /documents/{id}/html                      | 成品预览；download=1 下载 business-guide-vN.html 或 test-report-vN.html                                 |
| GET /deliveries/{id}/business-guide-materials | 下载最近成功指南的文稿 JSON；没有指南时从原说明素材整理初始文本，缺少页面或样例分类时明确提示待补充     |

business_guide 面向业务人员，按涉及模块与页面、功能操作、状态说明、实际页面与演示样例、页面图示、业务确认与反馈组织内容。新 test_report 使用 test-report-html-v1，按测试结论摘要、测试范围与覆盖、测试环境与方法、详细测试结果、问题与复验、人工评审与交付确认、技术附录与附件索引七章生成。原始 expected/actual、结果状态、冻结时人工判断及异常理由分别呈现；统计取自最终冻结 Run，排除项不计为 skipped，不拼接历史 Run。已有成功报告保留原文件与摘要；business-html-v2-geist 失败版本重试仍使用原模板，新建报告才使用新结构。业务指南的模板和文稿规则不变。两类分别从 v1 编号、生成、重试、预览和下载；需求概览中的 latestDocument 继续表示测试报告，latestGuide 表示业务指南。

指南文稿为 BusinessGuide 结构：schemaVersion=1、title、summary、modules、pages、sections、review、limitations，类型见 [API 客户端](../packages/api-client/src/delivery.ts)。sections.blocks 支持 heading/paragraph/note/quote/steps/confirmations/table/images。所有文字按纯文本转义，不接受 HTML 模板或脚本。图片只引用当前交付已保留的附件，kind 须明确为 actual 或 sample，crop 和 annotations 使用 0–100 的百分比范围。文稿不超过 1 MiB，图片累计不超过 128 次引用及 64 MiB。原素材没有样例类型时，不推断为实际页面。

新指南可通过 guide 提交独立文稿；省略时沿用最近成功文稿，首次使用现有说明素材整理文本。文稿与该文档版本一起不可变保存，失败重试也使用原文稿。更新文稿须创建新版本，不修改来源 Run、冻结材料或成功成品，也无需补挂附件或新造 Run。指南文字是使用说明，不替代原验证结论。首次整理后应核对业务措辞、页面入口及样例类型。

同 requestId 生成成功返回既有版本 200；同标识用于其他交付、其他文档类型或不同显式指南文稿返回 409 DOCUMENT_REQUEST_CONFLICT。新的明确 requestId 创建同类型的新版本。成功版本不重写。同类型生成中返回 409 DOCUMENT_GENERATING；两类生成互不占用资格，不引入队列。

显式 retry 和同 requestId 重试须确认 failed，先清理残留成品目录，再占用 generating 并增加 attempts。清理失败返回 500 READ_FAILED，原 status/attempts 保持不变；成功文件缺失或损坏仍在读取时报错，不自动重建。生成请求先保存 generating，文件同步发布后保存 succeeded 并返回 201；渲染失败返回 200 的 failed 记录及 error；状态保存失败返回 500，客户端须回读确认。服务重启将中断生成标成 failed，清理临时文件，允许原版本重试。

仅 valid 交付允许新生成或失败重试，否则返回 409 DELIVERY_INACTIVE。历史成功文档仍可预览下载；未成功返回 409 DOCUMENT_NOT_READY，摘要不匹配返回 500 DOCUMENT_INTEGRITY_FAILED。文件固定模板、转义文本、内嵌栅格图片及许可字体，无外部脚本或 CDN；HTTP 使用 nosniff 与 sandbox CSP，Web 使用无许可 sandbox iframe。测试报告内嵌冻结的栅格截图，并按检查项关联原始附件，技术附录列出全部文件、大小、SHA-256 与关联项。文本附件每份预览最多 256 KiB、合计最多 4 MiB，截断明确提示，二进制原件在交付详情页读取。验证方式只按 actual 中明确的真实、受控或恢复描述作阅读标注，不从文件名推断；未声明的方法与步骤如实显示未记录。目录、展开检查项、原尺寸图示及文本预览不依赖脚本。指南的目录、展开图示和阅读勾选不依赖脚本；勾选不保存，不提交人工验收。离线文件不自动随交付效力变化更新。

## 持久化与迁移

数据库版本增至 4。v3→v4 前以 VACUUM INTO 保存 archive.before-v4.*.db 一致备份；旧文档标为 test_report，保留 id、版本、状态、摘要及 HTML 原始字节，唯一版本键调整为 delivery_id/kind/version。更早版本仍依次执行已有迁移及备份。旧版逐项人审迁移规则仍单独适用，不将历史整轮决定推断为新冻结交付。

交付副本位于 deliveries/<id>/evidence，说明成品位于 documents/<id>/business.html。交付表不依赖来源记录的级联删除；数据库触发器保护冻结内容、事件及成功说明状态。数据库决定可见性，启动清理无归属目录及中断临时产物。

文件发布与恢复共用归属规则：存在快照记录就保留交付副本，不受当前效力影响；成功文档保留成品。运行时失败清理仅处理当前发布尝试，必须在事务结束后核对归属；无法确认归属时保留目录并返回错误，清理错误不得忽略。启动恢复的归属查询或清理失败继续阻止启动，修复环境后重启可再次恢复，不自动续跑文档生成。

## Web 入口与状态

需求顶部展示交付准备、阻塞原因及下一步。完整范围评审、本轮人工验收、交付版本和两类文档分别表达；本轮批量操作使用“全部人工通过”，完成后显示“本轮已验收”。“查看交付准备”允许未满足条件的报告进入审阅，最终“确认交付并保存快照”仍须满足全部既有门槛。

需求级概览复用冻结准备校验，只读取 campaign.latest_run_id，不回退历史报告。人工评审、作废、删除和刷新报告后并行回读概览；概览读取失败单独提示，不映射为尚未交付，也不延长本轮审核锁。概览同时保留当前有效交付与最新报告的独立进度；两类最新文档均关联所展示的交付版本。无最新报告时 preparation=null，已冻结历史继续可读。
