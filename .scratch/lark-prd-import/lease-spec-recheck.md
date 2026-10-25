Spec 轴只读复核 `f8764853fc052a72475be66c0a1f02274162b53a...86b8efb68088ce52a6ed932377f88163741c0993`：同步恢复 GET 的租约取消缺口已修，但新增 1 项实质竞态。

- [P2] 旧 AfterFunc 回调可取消已续租的任务。[spec:202](/Users/chulan/project/my-project/acceptances/.scratch/lark-prd-import/spec.md:202)要求“90 秒领取租约，由连接器每 15 秒续租”，[spec:218](/Users/chulan/project/my-project/acceptances/.scratch/lark-prd-import/spec.md:218)允许“同进程租约内可重传同次整包”。[lark.go:170](/Users/chulan/project/my-project/acceptances/internal/cli/lark.go:170)的回调无条件取消任务；[lark.go:225](/Users/chulan/project/my-project/acceptances/internal/cli/lark.go:225)及 265 行续租 Reset 与回调没有协调。如果续租已成功返回并通过 ctx.Err 检查，此后旧 timer 已到期、回调已启动但尚未执行 cancel，Reset 不能撤销该回调。旧回调随后仍将新有效任务取消为 IMPORT_LEASE_EXPIRED，导致读取/上传中止，服务端却仍持有有效续租。临近截止时间的慢网络、进程调度暂停或电脑唤醒可触发。标准库明确 AfterFunc Reset 返回 false 时不等待先前回调结束，也不保证回调不重叠；race detector 不会把这种语义问题报作数据竞争。需让续租更新与回调到期判断同步，回调只取消当前且确实到期的租约，不能直接对整个任务执行无条件 cancel。

已用不依赖项目的短实验 `/tmp/acceptances-lark-lease-timer-race.go` 验证 API 边界：旧回调启动后暂缓执行，Reset 延长 1 小时，再放行旧回调，输出 `reset_active=false renewed_for=1h actual_cause=IMPORT_LEASE_EXPIRED`。该实验只证明必要的调度交错，不冒充项目完整链路复现。

其他复核结果：租约直接取消可打断 candidateReady 的 Retry-After；成功 ready 恢复仍检查 task/attempt/connector；取消后结果不再被误报为 ready 或十分钟超时。已读取修复回执及普通/race 单项 PASS 日志，没有重复长测试。

未修改仓库或 Git，未运行浏览器、真实 Lark/VPS。上述 timer 协调问题解决前，本补丁尚不能关闭 Spec 复核。
