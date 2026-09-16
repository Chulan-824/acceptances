# 磁盘上的 Round

一份 Round 是一个带时间戳的目录。校验封存前是 Draft Round；`validate --seal` 成功后成为 Published Round。封存后，Raw Round 中的 `result.json`、`report.md` 和 `assets/` 保持不变。人审页面只写 overlay 文件 `reviews.json`。

```text
.acceptances/<subject>/<YYYYMMDD-HHMMSS>-<slug>/
  result.json
  report.md
  assets/
  reviews.json
```

`.acceptances/` 默认保留在本地并加入项目的 `.gitignore`。不要暂存或提交其中的验收证据，除非项目规则明确要求版本管理。

## result.json

顶层必填字段：

- `title`
- `createdAt`，使用带时区的 ISO 8601 时间
- `surfaces`
- `plan[]`
- `cases[]`
- `summary`

已知时记录 `branch`、`commit` 和 `entry`。

每个 `plan[]` 项包含：

- `id`
- `title`
- `category`
- `verifier`，取值为 `program`、`agent` 或 `llm`
- `method`
- `expected`
- `requiredEvidence`

`requiredEvidence` 支持 `screenshot`、`gif`、`video`、`audio`、`text`、`markdown`、`dom_snapshot` 和 `transcript`。

每个 `cases[]` 项使用计划中的同一个 `id`，并包含：

- `name`
- `category`
- `surface`，取值为 `web`、`desktop`、`cli`、`mobile` 或 `bot`
- `status`，取值为 `pass`、`fail` 或 `blocked`
- `observation`
- `evidence`

`evidence` 引用 `assets/` 下的相对路径，也可以使用带 `comparison` 的对象。

`summary` 包含 `total`、`passed`、`failed`、`blocked`、`verdict` 和 `conclusion`。`verdict` 取值为 `pass`、`fail` 或 `partial`。存在计划但没有 case 时，该项是未执行，不得计入通过。

`report.md` 只写本轮备注、工程门禁结果和后续事项，不重复抄写检查项表格。

## 证据对比

同一视图的前后对比共享 `comparison.id`，`role` 分别为 `before` 和 `after`。`layout` 可以是 `horizontal` 或 `vertical`，缺省为 `horizontal`。

流程中前后两步的普通截图不是对比对，按顺序分别引用即可。

## overlay 和 Receipt

`reviews.json` 的键是 `cases[].id`。`reject` 必须包含非空 `reason`，`accept` 不需要理由。最后一次人工操作覆盖同一检查项的旧 overlay。Builder 不写这个文件。

Receipt 位于 `.acceptances/.meta/<subject>/<round>.json`，不属于 Raw Round。不要手写或修改 Receipt；封存和摘要核对只通过 Acceptances CLI 完成。
