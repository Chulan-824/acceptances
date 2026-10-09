# 本地归档 API

服务仅供本机使用，无账号或 token。所有业务路由以 `/api/v1` 开头，JSON 字段采用 camelCase。列表返回 `{ "items": [] }`；错误返回 `{ "code": "...", "message": "..." }`。ID 由服务生成，格式为 UUID。

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
- Run：`id, campaignId, submissionId, report, status, voidReason, createdAt, reviews`。
- Review：`id, runId, kind, body, createdAt`。

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

| 方法与路由                         | 行为                               |
| ---------------------------------- | ---------------------------------- |
| POST /runs/{id}/reviews            | `{kind, body}`；kind 为 `comment   | accepted | rejected`，返回 201 Review |
| POST /runs/{id}/void               | `{reason}`；原因非空，返回 200 Run |
| GET /runs/{id}/evidence/{filename} | 查看附件；`?download=1` 强制下载   |

comment 正文必填；接受、拒绝可不填写正文。补充说明不会改写报告。历史 Run 的决定不会改变当前 Campaign。新 Run 令 Campaign 待审；作废当前 Run 同样令 Campaign 待审。作废记录可追加说明，不能再接受或拒绝；重复作废返回 409。

报告与附件没有编辑接口。附件通过受限根目录读取，PNG/JPEG/GIF/WebP、MP4/WebM 与纯文本日志可预览，其余类型强制下载。所有附件设置 `nosniff` 与 CSP sandbox，HTML/SVG 不会作为同源可执行页面展示。

## 删除

Project、Campaign、Run 均有 `GET /{类型}/{id}/delete-preview`，返回 `{projects, campaigns, runs, evidence, reviews}` 影响数量。对应 `DELETE /{类型}/{id}` 返回 204，级联删除所属记录、附件与反馈。

删除最新 Run 后，Campaign 为 pending 且 latestRunId 为空；旧 Run 仍保留，但其决定不会自动恢复。没有回收站。启动时清理崩溃留下的临时上传与无归属附件。

## 启动与边界

- `ACCEPTANCES_DATA_DIR` 或 `--data-dir`：默认 `data`，包含 `archive.db` 与 `evidence/<run-id>/<filename>`。
- `ACCEPTANCES_LISTEN` 或 `--listen`：默认 `127.0.0.1:8765`。
- `--web-dir`：默认 `apps/web/dist`，空字符串禁用页面。
- `GET /health/live` 和 `GET /health/ready`：存活与数据库就绪。
- `GET /api/v1/capabilities`：包含 `apiVersions: ["v1"]`、`phase: "local-archive"`、版本和提交标识。

Host 仅接受 localhost 或回环 IP；浏览器 Origin 如存在必须与 Host 同源。CLI 无需 Origin。没有远程访问或反向代理配置。
