# Lark PRD 审查修复回执

最终提交：`90da732ab2504a04576f18a7da96ce1cf19c023a`，分支 `codex/lark-prd-connector`。提交前已合并最新集成分支，基线为 `2b4eeef`。仅本地提交，未推送、部署或操作日常数据。

## 发现与处理

| 实质发现 | 修复 | 状态 |
| --- | --- | --- |
| Retry-After 最小等待被截成 60 秒 | Lark `retry_after_seconds` 和平台 `Retry-After` 秒数、HTTP-date 均保留最早重试时间；秒数转换和 jitter 加法防止 duration 溢出 | 完成 |
| `LARK_VERSION_CHANGED` 被提示为 CLI 版本变化 | 改为“PRD 在读取期间持续变更，请待原文稳定后重新导入。”；真正 `LARK_CLI_VERSION_UNSUPPORTED` 启动提示保持原样 | 完成 |

Standards 和 Spec 审查中的文案问题是同一个发现，不重复计数。没有修改错误码或服务端失败白名单。

按 [Lark 1.0.98 官方错误合同](https://github.com/larksuite/cli/blob/v1.0.98/errs/ERROR_CONTRACT.md#wire-format)，同一最小等待字段也适用于可重试 network 错误；该分支原先忽略字段，本次一并修正。

生产实现沿用现有 `time.Timer`、任务 context、续租和信号取消，不增加测试时钟或通用重试框架。大于 `time.Duration` 可表示范围的等待饱和到最大正 duration，任务期限或取消先结束等待；加 jitter 时也不允许整数回绕。重试总次数仍最多三次。

## RED→GREEN

Web 通过公开 controller 的可观察状态验证。新增失败任务 `errorCode=LARK_VERSION_CHANGED` 的回归，先因旧文案“本机 Lark CLI 版本已变化，请重新启动连接器。”失败；修改映射后 Campaign PRD 14 项测试通过。

CLI 通过独立公开进程、受控外部 Lark 可执行文件和临时 HTTP 服务验证，没有直接测试私有函数。长等待测试在旧实现下于 `63.65s` 失败，明确观察到：

- Lark 120 秒要求在约 60 秒后重发。
- 平台 120 秒和 HTTP-date 同样提前约一分钟重发。
- 超大秒数被截短或解析失败，发生提前重发。

修复后首轮相关 CLI 回归通过，包耗时 `132.453s`。最终带时间戳的长等待回归再次通过，测试耗时 `123.51s`、包耗时 `124.362s`，实际等待生产规定的时间，没有缩短测试等待语义。

| 观察场景 | 首次限流 | 最早允许重试 | 实际重试 |
| --- | --- | --- | --- |
| Lark api/rate_limit，120 秒 | 2026-10-25T16:20:52.694335Z | 2026-10-25T16:22:52.694335Z | 2026-10-25T16:22:53.020830Z |
| Lark network，120 秒 | 2026-10-25T16:20:53.593185Z | 2026-10-25T16:22:53.593185Z | 2026-10-25T16:22:53.961119Z |
| 平台 120 秒 | 2026-10-25T16:20:53.877843Z | 2026-10-25T16:22:53.877843Z | 2026-10-25T16:22:54.108936Z |
| 平台 HTTP-date | 2026-10-25T16:20:54.999941Z | 2026-10-25T16:22:54.000000Z | 2026-10-25T16:22:54.085567Z |

同轮并发受控场景覆盖 Lark 秒数 `9223372036854775807`、平台秒数 `184467440737095516160` 和 9999 年 HTTP-date。等待期间均无提前重放；发送信号后连接器退出并撤销注册。原有短限流/上传断链恢复、忙碌任务取消及真正 CLI 版本不支持提示的相关回归另行通过，包耗时 `25.571s`。

## 实际命令与结果

以下命令均在 `/Users/chulan/.codex/worktrees/lark-prd-connector/acceptances` 执行。

```sh
GOCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-build \
GOMODCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-mod \
go test ./internal/cli \
  -run 'TestLarkConnectHonorsMinimumRetryAfterAndCancelsLongWait' -count=1 -v
```

通过。完整 stdout 已保留在 `/tmp/acceptances-lark-review-cli.log`。

```sh
GOCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-build \
GOMODCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-mod \
go test ./internal/cli \
  -run 'TestLarkConnectKeepsUnsupportedCLIVersionPrompt|TestLarkConnectRetriesRateLimitAndLostUploadConnection|TestLarkConnectCancelsSubprocessAndCleansTemporaryResources' \
  -count=1 -v
```

3 项通过，分别为 `0.74s`、`7.92s`、`16.35s`，包耗时 `25.571s`。

```sh
node --test apps/web/tests/campaign-prd.test.mjs
pnpm exec prettier --check apps/web/src/campaign-prd-controller.ts apps/web/tests/campaign-prd.test.mjs
pnpm exec eslint apps/web/src/campaign-prd-controller.ts apps/web/tests/campaign-prd.test.mjs
pnpm --dir apps/web typecheck
GOCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-build \
GOMODCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-mod \
go vet ./internal/cli
```

Web 14 项通过，最终输出耗时 `181.701667ms`，见 `/tmp/acceptances-lark-review-web.log`。Prettier、ESLint、TypeScript 和 Go vet 均通过。暂存差异检查和仓库提交 hook 通过。

## 范围与未运行项

修改限定为 CLI 重试实现、公开 CLI 回归、Web 错误映射及其状态回归，共 5 个文件。本轮没有重复 API/MySQL 完整长测试、整个 Web 套件、构建或浏览器回归；主任务在 `2b4eeef` 的完整验证有独立回执，最终集成复查由主任务执行。

未访问实际个人 PRD、发起新授权、部署 VPS 或操作日常数据。既有非 Unix 进程树取消、真实 Lark、多成员电脑和 VPS 验收边界保持原样，本轮结果不证明这些外部场景已通过。
