# Standards 租约回调协调复核

只读对象：`/Users/chulan/.codex/worktrees/lark-prd-connector/acceptances`，基线 `1ffaa70` 的未提交 `git diff -- internal/cli/lark.go`，27 增 5 删。受审文件 Git blob 标识为 `9092601e52766d453393d49bd746a03ba491358a`，可在实现者提交后核对内容是否一致。

结论：未发现新增实质规范违反或值得报告的 possible smell。硬性违反 0，possible smell 0。

- `leaseMu` 将当前 `expiry` 更新、`lease.Reset`、旧回调的到期判断与取消放入同一临界区。续租先获得锁时，已经启动的旧回调读取新期限并退出；到期取消先生效时，续租检查 `ctx.Err()` 后返回失败，不恢复已取消的执行。
- timer 回调只读取共享期限并取消 context。其余 `expiry` 访问及写入都在主执行 goroutine，回调不修改期限；未见新的数据竞争或反向锁顺序。临界区没有 HTTP、子进程或结果等待。
- 取消函数仍由任务生命周期统一清理，fetch/upload 回收及 timer/ticker 的 Stop 保留。`Stop` 不等待已开始的回调，但回调只访问闭包持有的 mutex、期限与可重复取消的 context，不依赖 execute 栈返回后的外部资源。
- `renewLease` 汇聚两个必要续租调用点，未引入通用锁/时钟抽象。续租输入仍先经过既有 poll 的有效期限和领取凭据校验，信任边界未扩大。

此前 Standards 发现保持关闭。本次不替代 Spec 轴对所有定时竞态的判断，也不把静态复核称为 race 验证。

本轮没有运行测试、修改源码或 Git。实现者的最终测试回执与提交 SHA 尚待补齐；提交后若 blob 不同，需要按差异继续复核。

根集成补记：实现者最终提交 `0822502aedb57cc6badd06ba779e3bd832393b5e`，由独立 merger 合入 `754210dfb41118f67f14135655dfc5bf95048b29`；已核对受审文件 blob 完全一致，未在审后变更代码。
