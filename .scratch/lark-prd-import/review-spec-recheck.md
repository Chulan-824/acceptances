Spec 轴只读复查 `2b4eeef...90da732ab2504a04576f18a7da96ce1cf19c023a`：原 2 项均关闭，本次修正未发现新的实质问题。

1. P2 限流等待：关闭。规格原句“遵从 retry_after 或指数退避加抖动，最多 3 次”现已满足。[lark_reader.go:411](/Users/chulan/project/my-project/acceptances/internal/cli/lark_reader.go:411)保留 Lark 的最小等待，network 分支也使用该字段。[lark.go:407](/Users/chulan/project/my-project/acceptances/internal/cli/lark.go:407)同时处理平台秒数与 HTTP-date；超大秒数饱和到最大正 duration，[lark.go:404](/Users/chulan/project/my-project/acceptances/internal/cli/lark.go:404)只添加可容纳的正 jitter，不发生加法回绕。既有 `larkWait` 保持 context/signal 可取消，任务和领取期限仍约束等待；没有为避免长等待而提前重放。

2. P3 文档版本提示：关闭。规格原句“重试后仍变动就报版本不稳定”已对应到 [campaign-prd-controller.ts:57](/Users/chulan/project/my-project/acceptances/apps/web/src/campaign-prd-controller.ts:57)的“PRD 在读取期间持续变更，请待原文稳定后重新导入。”真正 CLI 版本不兼容的启动错误保持独立。

已核对修复回执和 `/tmp/acceptances-lark-review-cli.log`。受控 Lark api/network、平台秒数及 HTTP-date 的实际再次请求均不早于上游 120 秒下限；超大秒数及远期日期场景没有提前重放，信号取消退出。Web 新增回归从失败任务状态验证文案，回执记录 14 项通过。以上仍属于公开 Acceptances CLI 配合受控外部 Lark 与 HTTP 的工程证据。

未重复长测试或浏览器回归，未修改仓库或 Git。真实 Lark、双机/VPS 与非 Unix 进程树保证仍按既有外部验收缺口保留。
