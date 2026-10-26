只读 Spec 审查，基线 `3d4d8b8b97cc3dd0f2adbcb200e5264994b5a50f` → `2b4eeef`，发现 2 项。

1. [P2] 限流等待被截短，违背上游最早重试时间。[规格:222](/Users/chulan/project/my-project/acceptances/.scratch/lark-prd-import/spec.md:222)要求“遵从 retry_after 或指数退避加抖动，最多 3 次”。[lark_reader.go:411](/Users/chulan/project/my-project/acceptances/internal/cli/lark_reader.go:411)先把 Lark 的等待截到 60 秒，[lark.go:398](/Users/chulan/project/my-project/acceptances/internal/cli/lark.go:398)再次限为 60 秒，平台 HTTP 的 `retryAfter` 也同样截短。实际返回 `retry_after_seconds=120` 或 `Retry-After: 120` 时，连接器约 60 秒就重放，可能在限流解除前耗尽三次机会，让本可恢复的导入失败。1.0.98 [官方错误合同](https://github.com/larksuite/cli/blob/v1.0.98/errs/ERROR_CONTRACT.md#wire-format)明确该字段是最小等待。应保留上游等待，任务期限不足时终止，而不是提前重试。

2. [P3] 文档版本不稳定被提示为 CLI 版本变化。[规格:139](/Users/chulan/project/my-project/acceptances/.scratch/lark-prd-import/spec.md:139)要求“重试后仍变动就报版本不稳定”。[lark_reader.go:121](/Users/chulan/project/my-project/acceptances/internal/cli/lark_reader.go:121)在文档修订持续变化后返回 `LARK_VERSION_CHANGED`，但 [campaign-prd-controller.ts:57](/Users/chulan/project/my-project/acceptances/apps/web/src/campaign-prd-controller.ts:57)显示“本机 Lark CLI 版本已变化，请重新启动连接器”。持续编辑 PRD 即可触发，CLI 仍可保持 1.0.98；用户得到错误的恢复指引。应提示原文读取期间持续变更，稳定后重新导入。

未发现越出本期范围的实质行为。未运行长测试、浏览器或真实文档读取，未修改仓库或 Git；真实 Lark、双机/VPS 和非 Unix 进程树保证仍属已公开的外部验收缺口。
