# Lark 租约续期与到期回调竞态修复

- 工作树：`/Users/chulan/.codex/worktrees/lark-prd-connector/acceptances`
- 分支：`codex/lark-prd-connector`
- 本次基线：`1ffaa70df23f3c2b8a83bf0cd0c6c6f4a311a99e`
- 最终提交：`0822502aedb57cc6badd06ba779e3bd832393b5e`，`fix(lark): 协调租约续期与到期回调`。
- 仅修改 `internal/cli/lark.go`（27 增、5 删）。提交前再次合并 `codex/lark-prd-import`，Already up to date；提交后工作树干净，临时 node_modules 符号链接已移除。
- 未推送、部署、读取真实 PRD、新增 Lark 授权或操作日常数据。

## 审定与修正

已读取 `/tmp/acceptances-lark-lease-spec-recheck.md`，并核对本机 Go 1.26.8 标准库 `src/time/sleep.go:154-161`：AfterFunc 的 Reset 返回 false 不等待旧回调，也不阻止新旧回调重叠。因此不能用 Reset 撤销已启动的旧回调。

在 execute 的局部生命周期中引入一个 `sync.Mutex`：

1. 到期回调持锁读取当前 expiry，仅当当前租约确实到期时取消执行上下文。
2. 续租持同一锁检查执行上下文仍有效，再更新 expiry 并 Reset。
3. 旧回调若在续租之后得到锁，会看到新的有效截止时间并返回；若到期回调先取消，续租的 ctx 检查会阻止重启该任务。

该锁只协调租约决策，HTTP、读取和上传均不持锁。保留租约直接取消整个任务的能力、十分钟超时与用户退出原因、候选 ready 恢复及上游最小重试等待；不增加通用时钟或私有测试接口。

## 标准库确定性交错实验（不是项目完整链路复现）

先复跑审查提供的旧回调实验：

```sh
GO111MODULE=off GOCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-build go run /tmp/acceptances-lark-lease-timer-race.go
```

实际输出：`reset_active=false renewed_for=1h actual_cause=IMPORT_LEASE_EXPIRED`。

修正后的仅标准库实验在旧回调已启动、等待放行时，持锁续租一小时并 Reset，再放行旧回调；随后让当前租约真正到期：

```sh
GO111MODULE=off GORACE=atexit_sleep_ms=0 GOCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-build go run -race /tmp/acceptances-lark-lease-timer-coordinated.go
```

实际通过，无 race 报告，输出：

```text
reset_active=false renewed_for=1h stale_callback_cause=<nil>
current_expiry_cause=IMPORT_LEASE_EXPIRED
```

两份实验文件均保存在上述 `/tmp` 路径，供归档。它们只证明标准库回调交错及锁定规则，不能声称公开 CLI 已确定性复现该稀有调度交错。

## 公开 CLI 回归与静态检查

使用已确认边界：真实 CLI 子进程、受控外部 Lark 可执行文件、回环 HTTP fixture；没有测试项目私有函数或替换时钟。现有三个场景覆盖五秒当前租约打断候选恢复的 Retry-After 120 等待、ready/heartbeat 竞态，以及子进程取消和临时资源清理。

缓存环境为 `GOCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-build`、`GOMODCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-mod`。实际命令：

```sh
GOCACHE=... GOMODCACHE=... go test ./internal/cli -run '^TestLarkConnect(EndsExpiredLeaseWhileCandidateRecoveryWaits|RecognizesReadyCandidateWhenUploadHeartbeatConflicts|CancelsSubprocessAndCleansTemporaryResources)$' -count=1 -v
GORACE=atexit_sleep_ms=0 GOCACHE=... GOMODCACHE=... go test -race ./internal/cli -run '^TestLarkConnect(EndsExpiredLeaseWhileCandidateRecoveryWaits|RecognizesReadyCandidateWhenUploadHeartbeatConflicts|CancelsSubprocessAndCleansTemporaryResources)$' -count=1 -v
```

- 普通三项全部 PASS，包 45.784 秒；子项 8.15 / 17.69 / 16.48 秒。原始日志 `/tmp/acceptances-lark-lease-coordination-ordinary.log`。
- race 三项全部 PASS，包 90.264 秒；子项 32.97 / 26.92 / 27.10 秒，无 race 报告。原始日志 `/tmp/acceptances-lark-lease-coordination-race.log`。
- `go vet ./internal/cli`（相同缓存环境）通过。
- gofmt、`git diff --cached --check`、`node scripts/v1/check-staged.mjs` 及提交 hook 均通过（一个 Go 文件）。

本次不重跑 120 秒长等待、完整 MySQL/API、真实页面或真实 Lark/VPS。真实成员授权、不同电脑、VPS 网络及非 Unix 进程树取消仍是独立验收边界。
