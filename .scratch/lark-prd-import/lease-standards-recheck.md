# Standards 最后补丁复核

只读范围：`f8764853fc052a72475be66c0a1f02274162b53a...86b8efb68088ce52a6ed932377f88163741c0993`，仅 `internal/cli/lark.go` 与 `internal/cli/lark_test.go`。结合完整 execute/poll 调用上下文及 `/tmp/acceptances-lark-lease-fix.md` 回执复核，未依赖集成分支是否合并。

## 原发现

此前 PRD 修订变化被错误描述为 CLI 版本变化的 Standards 项已关闭，本次补丁未触及该文案和覆盖。

## 本次结论

未发现新增实质规范违反或值得报告的 possible smell。

- `time.AfterFunc` 回调仅执行并发安全的上下文取消，不读写可变 `expiry`；有效续租后才 Reset。timer、ticker 和两个 context 的清理均限定在 execute 内，异步 fetch/upload 仍由既有 defer 取消并等待回收。
- `context.WithTimeoutCause` 与 `WithCancelCause` 区分任务超时、租约到期及父级退出。同步恢复请求和普通失败上报接入同一任务上下文，取消后复查上下文，避免按旧结果继续回传或提示成功。
- 保留 poll 对有效租约、task/attempt/claim token 的校验，未扩大输入、资源读取或凭据权限，也未改生产时限。标准库机制足以完成修复，没有引入时钟/重试通用抽象。
- 新用例经公开 CLI 子进程和受控 HTTP 响应观察五秒租约终止 120 秒恢复等待，并断言无重放、成功误报或过期任务失败回传；fixture 将短租约放在读取后的续租响应，避免把子进程启动开销混入目标窗口。

发现数量：硬性规范违反 0，possible smell 0，未关闭 Standards 项 0。

本轮未修改源码或 Git，未重跑测试、120 秒等待或浏览器。实现者回执中的执行结果未视为本轮独立实测；非 Unix 进程树与真实 Lark/VPS 验收仍沿用既有外部边界。
