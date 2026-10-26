# Lark 导入租约到期取消修复回执

- 工作树：`/Users/chulan/.codex/worktrees/lark-prd-connector/acceptances`
- 分支：`codex/lark-prd-connector`
- 修复基线：`f8764853fc052a72475be66c0a1f02274162b53a`
- 最终提交：`86b8efb68088ce52a6ed932377f88163741c0993`（`fix(lark): 租约到期取消整个导入任务`）
- 提交前再次 `git merge codex/lark-prd-import`，结果 Already up to date。提交后工作树干净；检查使用的临时 node_modules 符号链接已移除。
- 未推送、部署，未读取真实 PRD、执行 Lark 新授权或操作日常数据。

## 根因与修复

复核发现 heartbeat / pre-upload poll 已使用当前租约截止时间；真正可复现缺口是 `candidateReady` 的同步 GET 只使用十分钟任务上下文，遇到 `Retry-After: 120` 会阻塞主 select，原租约 timer 不能及时结束该等待。

`internal/cli/lark.go` 改为标准库 `time.AfterFunc` 在租约到期时直接取消整个执行上下文，覆盖读取子进程、上传、poll、候选状态恢复与正常 failure 回传；仅在有效续租后 Reset。`context.WithTimeoutCause` 与 `WithCancelCause` 区分十分钟任务超时、租约失效及父级用户退出；租约失效不误报 IMPORT_TIMEOUT，不回传新的 failure，不提前重试上游。保留已保存 ready 候选的恢复逻辑。

`internal/cli/lark_test.go` 通过公开 CLI 子进程、受控外部 Lark 和回环 HTTP fixture 验证：读取完成后的 pre-upload 续租给出真实五秒租约，上传返回 409，恢复 GET 返回 429 / Retry-After 120。CLI 必须在租约到期后两秒容差内回到空闲领取，不重放恢复 GET / 上传，不误报 ready / IMPORT_TIMEOUT，不继续报告过期任务失败。没有修改生产 90 秒租约、15 秒心跳或十分钟任务上限，没有新建通用时钟或重试抽象。

## RED → GREEN

缓存环境：

```sh
GOCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-build
GOMODCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-mod
```

首次 RED（生产代码未改，初版 fixture 从首次 claim 即给五秒）：

```sh
GOCACHE=... GOMODCACHE=... go test ./internal/cli -run '^TestLarkConnectEndsExpiredLeaseWhileCandidateRecoveryWaits$' -count=1 -v
```

实际失败：`expired task remained blocked by candidate recovery Retry-After`；测试 9.90 秒，包 10.777 秒。原始输出在本轮工具回执中，未单独保存原始文件。

生产修复后普通三项回归：

```sh
GOCACHE=... GOMODCACHE=... go test ./internal/cli -run '^TestLarkConnect(EndsExpiredLeaseWhileCandidateRecoveryWaits|RecognizesReadyCandidateWhenUploadHeartbeatConflicts|CancelsSubprocessAndCleansTemporaryResources)$' -count=1 -v
```

全部通过，包 41.275 秒：短租约 7.88 秒、ready/heartbeat 竞态 16.38 秒、子进程取消及临时资源清理 16.42 秒。完整输出：`/tmp/acceptances-lark-lease-green.log`。

首次 race 同组三项中，初版 fixture 的首次五秒租约被受控子进程的 race 启动耗时先耗尽，未进入目标 GET，90.02 秒后测试失败 `candidate recovery never reached the Retry-After response`。该命令总结果 FAIL（163.819 秒），不能记为 race 全组通过；同次 ready 竞态 42.58 秒、取消清理 27.14 秒均 PASS，没有报告数据竞争。输出：`/tmp/acceptances-lark-lease-race.log`。

将 fixture 的短租约改为读取完成后的 pre-upload 续租响应给五秒，首次 claim 保持正常 90 秒，使启动开销与目标租约窗口分离；未改生产逻辑。最终 fixture 的单项复跑：

```sh
GOCACHE=... GOMODCACHE=... go test ./internal/cli -run '^TestLarkConnectEndsExpiredLeaseWhileCandidateRecoveryWaits$' -count=1 -v
GORACE=atexit_sleep_ms=0 GOCACHE=... GOMODCACHE=... go test -race ./internal/cli -run '^TestLarkConnectEndsExpiredLeaseWhileCandidateRecoveryWaits$' -count=1 -v
```

- 普通 PASS：测试 7.81 秒，包 8.378 秒；`/tmp/acceptances-lark-lease-short-final.log`。
- race PASS：测试 32.07 秒，包 35.334 秒；`/tmp/acceptances-lark-lease-short-race-final.log`。
- 日志均确认 five-second lease 在 120 秒最小重试前终止恢复等待，无重放及已接收上传。

## 静态检查与边界

- `GOCACHE=... GOMODCACHE=... go vet ./internal/cli`：通过。
- gofmt、`git diff --cached --check`：通过。
- `node scripts/v1/check-staged.mjs` 与提交 hook：两个 Go 文件检查通过。
- 本次没有重跑 120 秒最小等待长回归、全库 MySQL/API、真实页面或真实 Lark/VPS；这些不属于本修复新证据。
- 非 Unix 仍仅保证取消直接子进程；真实 Lark 授权、不同电脑、VPS 网络与非 Unix 进程树验收仍须独立完成。
