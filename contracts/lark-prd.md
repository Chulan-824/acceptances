# Lark PRD 导入

成员在网页填写 Lark URL，指定的本机连接器主动向平台领取本人任务，以本机个人 Lark 授权读取并回传。平台不保存 Lark 认证凭据，不主动连接成员电脑。平台登录与 Lark 授权分别生效，CLI 与浏览器的七天平台会话也相互独立。

所有路由以 /api/v1 开头，JSON 字段为 camelCase，错误沿用 {code,message}。协议 DTO 定义在 internal/prd/types.go。PRD 是 Campaign 的需求输入，不是 Run、Evidence 或 Business Guide，导入不改变已有验收和交付结论。

## 身份和可见范围

- 连接器注册、轮询、上传、报告失败使用自己的平台 CLI Bearer。连接器凭据只证明本机进程，不替代平台登录。
- 创建导入、查看候选、取消和确认均绑定发起用户，不能因全员共享项目而由另一成员领取或预览。
- 确认后，全部登录用户均可访问快照和文件。首次导入必须提示共享范围，Lark 原文后续撤权或删除不自动删除快照。
- 上传的读取身份和内容属于本机报告，平台不能据此证明两个账号属于同一自然人，也不宣称独立验证过 Lark 原文。

## 连接器与导入接口

| 方法与路由                           | 请求或结果                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| POST /lark-connectors                | {name,protocolVersion,larkCliVersion}，返回 {connector,connectorToken}                |
| GET /lark-connectors                 | {items}，只列本人连接器，包含在线状态                                                 |
| DELETE /lark-connectors/{id}         | 断开本人连接器并终止未完成任务，204                                                   |
| POST /lark-connectors/{id}/poll      | 空闲传 {}；忙碌传 {importId,attempt,claimToken} 续租，返回 204 或 Claim               |
| POST /campaigns/{id}/prd-imports     | {url,connectorId,clientRequestId}，返回 202 Import                                    |
| GET /prd-imports/{id}                | 本人任务状态、错误码、候选 manifest 和 baseSnapshotId                                 |
| POST /prd-imports/{id}/result        | multipart 结果，返回 ready 状态                                                       |
| POST /prd-imports/{id}/failure       | {errorCode,phase,retryable}，报告安全错误，不上传原始认证输出                         |
| POST /prd-imports/{id}/cancel        | 幂等取消未确认任务，204                                                               |
| GET /prd-imports/{id}/files/{name}   | 仅本人读取候选文件                                                                    |
| POST /prd-imports/{id}/confirm       | {expectedCurrentSnapshotId,acceptPartial}，新快照返回 201，重复/复用返回 200 Snapshot |
| GET /campaigns/{id}/prd-snapshots    | {currentSnapshotId,items}，只包含已确认快照                                           |
| GET /prd-snapshots/{id}              | Snapshot，包含来源、确认人/时间和 manifest                                            |
| GET /prd-snapshots/{id}/files/{name} | 已确认快照文件，要求平台登录                                                          |

连接器请求携带 X-Acceptances-Connector-Token。result 和 failure 另携带 X-Acceptances-Claim-Token、X-Acceptances-Claim-Attempt。凭据不出现在 URL、日志或浏览器列表中。旧 attempt、过期租约、已取消任务和已断开的连接器不能提交结果。

Claim 包含 importId、campaignId、url、attempt、claimToken、leaseExpiresAt。轮询续租返回同一 Claim，不表示要重复执行同一任务。连接器进程重新启动后重新注册，旧任务不能静默转给另一电脑。

连接器撤销或正常退出结束其 queued/fetching 任务；已封存的 ready 候选仍可由原导入人在 24 小时有效期内确认，无需连接器继续在线。

## 内容合同

result 为 multipart/form-data，总请求不超过 128 MiB：

- manifest 是不超过 1 MiB 的 JSON 字段。
- 每个文件使用 file 字段，filename 必须与 manifest.files[].name 一致。
- source.json 和 document.md 必须存在，各不超过 8 MiB。
- 图片或画板资源最多 100 个，单资源最多 10 MiB。
- 文件只接受合法单层名称，拒绝缺失、重复、多余、路径穿越和摘要不符的附件。

manifest 至少包含 schemaVersion、documentId、realm、revisionId、title、fetchedAt、normalizerVersion、completeness、warnings、files 和 resources。revisionId 使用字符串，避免整数精度变化。正文结构、Markdown、来源和 manifest 必须属于同一文档及修订。SourceDocument 是剔除评论和临时 URL 后的结构副本，不是未经筛选的 API 响应。

当前规范化版本为 `lark-prd-v2-zh-CN`。图片 `src` 中的不透明资源 token 保留并交由个人 Lark CLI 下载，真正的 URL 不作为 token，也不直接请求。人员提及、普通 Doc/Wiki 链接及表格列、删除线、figure 容器不作为缺失资源；Sheet/Base 等真正嵌入仍明确列为不支持。同类未知块按类型汇总数量。

阅读视图将 Lark Markdown 中残留的 HTML 图片替换为已归档图片，将人员提及和普通文档引用转换为转义后的可见名称，将 XML 表格转换为 Markdown 表格，保留文字、删除线、列表编号和图片。单元格内段落及列表按行内文本排列，不还原原版式；合并单元格仍提示降级。代码示例中的标记保持原文，预览继续禁用原始 HTML。

已保存资源还包含各自的 fetchedAt（RFC3339 时间）。正文和资源无法原子读取；资源下载后再次检查文档修订号，变化则重读，仍不稳定时失败。读取时间用于展示来源，不参与正文或资源的语义摘要。

首期支持 HTTPS Docx，以及实际类型为 Docx 的 Wiki。去掉 query 和 fragment 并显式读取全文，使用固定 profile、user 身份和 zh-CN 语言。Markdown 用于阅读，XML 结构用于保留原始内容关系。旧 Doc、独立 Sheet/Base、Office/PDF 和应用页面不接受。

正文内静态表格和可下载图片/画板保留；附件正文、内嵌 Sheet/Base、同步引用及外链不递归读取。遗漏、下载失败和排版降级必须列为缺口，partial 候选需要发起人明确确认，不能把正文失败伪装成 partial。

## 保存与版本

result 先封存 blob，再用一笔事务保存候选元数据及文件引用并进入 ready。confirm 验证已有封存内容，在另一笔事务中建立快照关联并更新当前 PRD 指针。确认不重复 attach 同一 owner，不修改旧快照、Run 或 Delivery。

同一次请求按 clientRequestId 幂等，相同键参数不同返回冲突。同一任务的相同结果可重传，内容不同不能覆盖。来源按实际 documentId 和 API realm 识别，Wiki 别名与 Docx 直链不会制造第二个来源。

同修订、规范化版本、正文及资源摘要相同则复用快照；新修订即使内容相同仍记录新版本信息。原 partial 在同修订补齐资源可生成新快照，原版本保留。已成功内容在相同修订下发生变化时拒绝不一致结果。确认使用 expectedCurrentSnapshotId 处理并发，不自动把当前 PRD 降级到旧修订。

规范化版本升级后重新导入生成独立快照，旧版 manifest、正文和文件原样读取，不重新解析或覆盖。服务端与连接器需同步升级，已经运行的旧连接器进程需要重启；旧的已封存候选仍按原 manifest 确认。

未确认候选到期后可以移除引用，已确认快照按 Campaign 生命周期保留。当前文件后端没有已确认的 ready blob 自动 GC，不承诺候选过期后字节立即物理删除。完整备份恢复和删除引用安全单独验证。

## 验证边界

公开 HTTP 与隔离 MySQL 验证任务、文件和共享边界；受控 Lark 子进程验证本机协议与错误处理；Web 交互验证页面行为。受控结果不证明真实 Lark 权限、成员电脑或 VPS 生产链路已经通过。实际回执见对应实现验证记录。

PRD 分析和测试用例生成属于后续 TODO，不把未执行的分析或用例记为 Run。
