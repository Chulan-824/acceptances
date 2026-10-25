# 本地归档 API

浏览器使用会话 Cookie，CLI 使用 Bearer 会话凭据。业务 API 和附件要求登录，当前所有登录用户共享全部项目及操作能力。所有业务路由以 `/api/v1` 开头，JSON 字段采用 camelCase。列表返回 `{ "items": [] }`；错误返回 `{ "code": "...", "message": "..." }`。ID 由服务生成，格式为 UUID。

正式冻结、交付效力和独立业务说明接口见[交付 API](delivery.md)。这些材料复用现有 evidence，不扩展严格 Report schema。

个人本机连接器、URL 导入任务和共享需求快照见 [Lark PRD 导入](lark-prd.md)。PRD 与 Run、Evidence 和交付后业务说明分别保存。

## 用户与会话

- `POST /auth/register`：JSON `{username,password,client?}`，注册成功返回 201 `{user}` 并自动登录。用户名去除首尾空白、英文转小写，3–32 个 Unicode 字符，允许字母、数字和 `_ . -`；密码至少 7 个 Unicode 字符，不限制字符组合，最多 72 字节。
- `POST /auth/login`：同样输入，成功返回 200 `{user}`。账号或密码错误统一为 401 `LOGIN_FAILED`，重名注册返回 409 `USERNAME_TAKEN`。两接口要求 `application/json`，每个来源 IP 十分钟最多 30 次请求，超出返回 429。
- `GET /auth/me`：返回当前 `{id,username}`；`POST /auth/logout`：撤销当前会话，返回 204。
- 注册或登录携带 `client:"cli"` 时返回 `{user,token,expiresAt}`；普通浏览器通过 HttpOnly、SameSite=Strict Cookie 保持登录，HTTPS 入口设置 Secure。会话有效期七天，数据库保存 token 的 SHA-256 摘要。
- 未登录或会话过期统一返回 401 `AUTH_REQUIRED`；Cookie 写请求必须携带同源 Origin，CLI Bearer 请求无需 Origin。所有业务及附件路由均受保护，登录页面、静态资源、健康检查和 capabilities 公开。
- Project、Campaign、Run、Review 可包含 `createdBy:{id,username}`；旧记录缺省。该字段由服务端认证上下文设置，调用方不能指定。

## 项目与需求

| 方法与路由                       | 输入或返回                                                |
| -------------------------------- | --------------------------------------------------------- |
| GET /projects                    | Project 列表                                              |
| POST /projects                   | `{name, description?}`，返回 Project                      |
| GET /projects/{id}               | Project                                                   |
| GET /projects/{id}/repositories  | Repository 列表                                           |
| POST /projects/{id}/repositories | `{name, source}`，相同 Project/source 复用既有 Repository |
| GET /projects/{id}/campaigns     | Campaign 列表                                             |
| POST /projects/{id}/campaigns    | `{title, description?}`，返回 Campaign                    |
| GET /campaigns/{id}              | Campaign                                                  |
| GET /campaigns/{id}/runs         | Run 列表，包含完整报告与反馈                              |
| GET /runs/{id}                   | Run                                                       |

- Project：`id, name, description, createdAt`。
- Repository：`id, projectId, name, source`。source 是代码来源标识，不由服务访问或执行。
- Campaign：`id, projectId, title, description, status, latestRunId, createdAt`。
- Run：`id, campaignId, submissionId, report, status, voidReason, createdAt, reviews, checkReviews, reviewCounts, feedbackResponses, sourceRunAvailable?`。
- Review：`id, runId, checkId?, kind, body, createdAt, legacy`。
- `checkReviews`：每项当前人工判断，含 `checkId, status, lastReviewId`；`reviewCounts` 为 `pending, accepted, rejected` 数量。

Campaign 状态为 `pending | accepted | rejected`；Run 另有 `void`。保存完成与人工接受分别表达。创建返回 201，读取返回 200。

## 整包提交

`POST /campaigns/{id}/runs` 使用 multipart/form-data，总请求不超过 256 MiB：

- `submissionId`：1–200 字符的提交标识，CLI 自动生成并持久保存。
- `report`：不超过 1 MiB 的 JSON 文本，结构见下面示例。
- 每个文件使用 `evidence` 字段，filename 必须与报告中对应的 `evidence[].path` 完全相同。

```json
{
  "title": "交付标题",
  "description": "需求与验证说明",
  "verifiedAt": "2026-10-09T10:00:00Z",
  "scope": "局部复验：只验证上传失败重试",
  "environment": "unknown",
  "versions": [{ "repository": "web", "commit": "unknown", "dirty": null }],
  "checks": [
    {
      "id": "retry",
      "title": "上传失败可以重试",
      "expected": "同一提交最终仅有一条记录",
      "actual": "网络恢复后重试成功，列表只有一条记录",
      "status": "passed",
      "evidence": ["retry.log"]
    }
  ],
  "evidence": [{ "path": "retry.log", "description": "重试执行日志" }]
}
```

要求非空标题、范围、合法 RFC3339 时间及至少一个检查项。检查项 ID 唯一，标题、预期和实际结果非空；状态为 `passed | failed | blocked | skipped`。未知环境与版本归一化为 `unknown`，未知未提交状态为 null。失败或局部验证允许保存，不合并历史覆盖结果。

附件只允许单层文件名，不允许斜杠、反斜杠、换行、空字节、`.` 或 `..`。声明的附件必须全部上传，拒绝多余、重复或缺失附件；检查项证据引用必须指向声明的附件。

完整保存后返回 201 Run。相同 submissionId、Campaign、规范化报告与文件内容重试返回 200 既有 Run；内容不同返回 409 `SUBMISSION_CONFLICT`。multipart 文件顺序不影响重试。中断或校验失败不产生可见 Run。没有分片、断点续传或持久后台任务。

## 人工处理与证据

| 方法与路由                         | 行为                                                |
| ---------------------------------- | --------------------------------------------------- |
| POST /runs/{id}/reviews            | `{checkId?, kind, body?}`，返回 201 Review          |
| POST /runs/{id}/accept-all         | `{}`，批量人工通过当前 Run 全部检查项，返回 200 Run |
| POST /runs/{id}/void               | `{reason}`；原因非空，返回 200 Run                  |
| GET /runs/{id}/evidence/{filename} | 查看附件；`?download=1` 强制下载                    |

逐项接口 `kind` 为 `comment | accepted | rejected | pending`；非评论操作必须指定 `checkId`，未知检查项返回 400。评论与人工不通过正文必填；原始验证非 `passed` 项的逐项人工通过正文必填；普通通过与撤回理由可选。整轮仅能评论。评论不改变当前判断，历史以保存顺序取最新明确判断。

`accept-all` 是用户主动确认的一键交付，忽略页面筛选，原子地为每个尚未人工通过的检查项追加 `accepted` Review，可覆盖现有人审拒绝。批量通过无需输入理由，包括原始 `failed`、`blocked`、`skipped` 项；新判断统一说明为“一键交付：人工确认本轮全部检查项通过。”。已通过项跳过，重复请求仍返回 200 当前 Run，不重复写入；保存失败返回 500 `SAVE_FAILED` 并整批回滚。作废返回 409 `RUN_VOID`，不存在返回 404 `RUN_NOT_FOUND`。

Run 作废优先，其余以不通过、待审、全部通过的顺序计算；全部人工通过即本轮已交付，改判或撤回重新计算。Campaign 只由最新 Run 决定，最新完整范围 Run 全部通过才整体通过；局部和未知范围通过后仍待审。历史 Run 的决定不会改变当前 Campaign，新 Run 不继承判断并令 Campaign 待审。作废当前 Run 同样令 Campaign 待审；作废记录可追加评论，不能通过、不通过、撤回或一键交付，重复作废返回 409。补充说明及人工判断不会改写原报告或附件。

报告与附件没有编辑接口。附件通过受限根目录读取，PNG/JPEG/GIF/WebP、MP4/WebM 与纯文本日志可预览，其余类型强制下载。所有附件设置 `nosniff` 与 CSP sandbox，HTML/SVG 不会作为同源可执行页面展示。

## 删除

Project、Campaign、Run 均有 `GET /{类型}/{id}/delete-preview`，返回 `{projects, campaigns, runs, evidence, reviews}` 影响数量。对应 `DELETE /{类型}/{id}` 返回 204，级联删除所属记录、附件与反馈。

删除最新 Run 后，Campaign 为 pending 且 latestRunId 为空；旧 Run 仍保留，但其决定不会自动恢复。没有回收站。启动时清理崩溃留下的临时上传与无归属附件。

## 启动与边界

- `ACCEPTANCES_DATA_DIR` 或 `--data-dir`：默认 `data`，保留归档兼容目录；当前业务与附件使用 MySQL。
- `ACCEPTANCES_LISTEN` 或 `--listen`：默认 `127.0.0.1:8765`。
- `--web-dir`：默认 `apps/web/dist`，空字符串禁用页面。
- `GET /health/live` 和 `GET /health/ready`：存活与数据库就绪。
- `GET /api/v1/capabilities`：包含 `apiVersions: ["v1"]`、`phase: "local-archive"`、版本和提交标识。

默认 Host 接受 localhost 或回环 IP。远程反向代理需设置 `ACCEPTANCES_PUBLIC_ORIGIN=https://你的域名`，保留原始 Host；服务只信任该配置的公共 Host 和 Origin，不信任任意转发头。远程配置必须使用 HTTPS，代理终止 TLS，应用端口和数据库仅供内网访问。

## 首页看板摘要

`GET /dashboard` 返回 `{items: DashboardItem[]}`，按最新 Run 创建时间降序排列，无 Run 时按需求创建时间排列。同时间按需求 ID 排序。

每项的 `delivery` 为 `{id, version, status}` 或 `null`：优先返回该需求当前有效交付，否则返回最新历史交付，无交付记录时为 `null`。卡片据此直达 `/deliveries/{id}`，有效交付显示“查看交付”，历史交付显示“查看历史交付”；不以需求人工评审状态推断交付是否存在，新 Run 不隐藏仍有效的旧交付。

每项包含 Campaign 字段、`projectName` 和可空 `latestRun`。最新验证摘要包含 `id, status, createdAt, verifiedAt, scopeType, versions, counts, evidenceCount, checks`。`counts` 分别统计 passed、failed、blocked、skipped；`checks` 仅含前四项的 id、title、status。缺失范围归一化为 unknown。不返回完整报告、附件正文或评审历史。

需求状态直接使用 Campaign 状态，不能由检查通过率或 Run 人工通过推导。作废最新 Run 仍显示其摘要；删除最新 Run 后返回 null，不回退到历史报告。根路由统计卡按所选项目计数，不随关键词或状态筛选变化。
