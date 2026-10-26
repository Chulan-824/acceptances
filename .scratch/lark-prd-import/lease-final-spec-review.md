Spec 轴最终短复核：未提交的租约协调小修已从根因关闭此前新增 P2，未发现新的实质问题。当前结论针对工作树 `/Users/chulan/.codex/worktrees/lark-prd-connector/acceptances`，基线 `1ffaa70` 的 `internal/cli/lark.go` 差异；最终提交 SHA 尚待实现者提供。

- 此前 P2“旧 AfterFunc 回调取消已续租任务”：关闭。`lark.go:172` 回调和 `182` 行 `renewLease` 通过同一 `leaseMu` 协调当前 expiry。续租先持锁时，已启动的旧回调随后看到更新后的未来截止时间，直接返回，不取消有效任务。到期回调先持锁取消时，续租会在锁内读取 ctx.Err 并拒绝恢复，不会复活过期任务。两处续租入口统一使用此逻辑。
- 原同步 candidateReady 的长 Retry-After 仍受执行 context 取消，租约结束可中止恢复、读取和上传；ready 恢复、身份/attempt 复核、租约与十分钟超时的原因区分没有被本次小修改变。未重新引入提前重试或幽灵 ready。
- 没有发现新增的共享内存竞态或锁循环：expiry 的更新在主执行 goroutine 中完成，回调读取使用同一锁；锁只保护期限判断/更新和 timer Reset，没有持锁执行 HTTP 或读取文档。

审查文件的完整 Git blob 为 `9092601e52766d453393d49bd746a03ba491358a`。被审差异另存 `/tmp/acceptances-lark-lease-final-reviewed.diff`，最终 SHA 到达后仅需核对该 blob 未变。

本轮为只读静态复核，没有重复长测试或浏览器回归；实现者的短测试及确定性交错实验结果由主任务合并证据。未修改仓库或 Git。真实 Lark、双机/VPS、非 Unix 进程树等既有外部验收边界保持不变。

根集成补记：实现者最终提交 `0822502aedb57cc6badd06ba779e3bd832393b5e`，由独立 merger 合入 `754210dfb41118f67f14135655dfc5bf95048b29`；已核对受审文件 blob 完全一致，未在审后变更代码。
