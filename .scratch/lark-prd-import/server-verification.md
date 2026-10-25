# 服务端任务 02 验证回执

- 工作树：`/Users/chulan/.codex/worktrees/lark-prd-server/acceptances`
- 分支：`codex/lark-prd-server`；提交 `ca1f592`，父提交集成分支 `8ba0503`；本地提交，无推送或部署。
- 数据边界：公开 HTTP + 每测试专用 MySQL 数据库；仅读取测试入口指定的 DSN 文件，由已有隔离器创建/回收 `acceptances_test_*`。未读取 `.env*`，未访问日常报告，未推送或部署。

## TDD 红绿证据

命令使用 `GIN_MODE=release`、已有 Go 缓存及 `ACCEPTANCES_MYSQL_TEST_DSN_FILE` 注入；不在回执记录凭据。

| 切片 | 变更前实际结果 | 实现后实际结果 |
| --- | --- | --- |
| `TestPRDConnectorIsPrivate` | POST 登记返回 404 | 登记 201，本人列表/断开与他人 404 通过 |
| `TestPRDTasksStayWithChosenReader` | 创建任务返回 404 | 规范 URL、幂等、本人认领/取消与错误凭据通过 |
| `TestPRDConfirmedSnapshotIsSharedAndImmutable` | multipart result 返回 404 | 两阶段结果/确认、本人预览和共享文件通过；前三项合计 9.821s |
| `TestPRDFileAuditAndCampaignDeletion` | 审计成功但 files=0/objects=0，遗漏 PRD | 纳入 owner 与审计后通过，空目录重启读取、删除影响和级联通过（2.861s） |
| `TestPRDUploadRejectsUntrustedBundleAndPath` | `../document.md` 被 Go 解析截短并返回 200 ready | 校验原始 Content-Disposition 后，穿越/摘要/缺失/多余文件/修订不一致全部拒绝（2.986s） |
| `TestPRDRepeatedResourceCannotHideChangedBytes` | 同一 token 多处引用时，一处新字节被最后的旧字节遮蔽，确认返回 200 | 对比该资源的全部字节摘要集合，返回 IMPORT_INCONSISTENT；与 partial 组回归通过（5.925s） |
| `TestLoginMigrationPreservesExistingProjects` | 新增 004 后，旧断言仍要求迁移数=3，失败（9.518s） | 预期改为 4，既有项目内容与迁移历史均保留（4.194s） |

复跑命令示例：`go test ./internal/api -run '^TestPRDUploadRejects' -count=1 -timeout=120s`，其余按上述测试名选择。

## 行为覆盖

- 两用户隔离候选、连接器和任务；仅平台 Bearer 可登记/轮询/提交执行结果，Cookie 不可冒充本机连接器。
- 指定设备、claim token/attempt、领取租约、取消/失联晚到、平台会话撤销、固定安全失败码。
- 相同 clientRequestId 响应丢失后的恢复先于在线门禁；离线/断开仍返回同任务；不同请求冲突。
- 重复上传/确认、同修订稳定摘要去重、Docx/Wiki 别名、来源强绑定、跨来源拒绝、超过 JS 精度的修订号与旧版本阻止。
- partial 明确接受、补全另建不可变版本、完整版本不降级、同修订正文/已保存素材字节变动拒绝。
- 并发确认仅一个成功，另一方必须显式刷新 head；已经确认的任务无论 head 后来改变仍返回原快照。
- 附件挂接故障注入时，业务元数据与全部引用回滚；ready blob 沿已有防丢失规则保留，不声称自动 GC。
- SQL 不可变保护、同 Campaign 的快照/head 约束、Range 读取、ready 断开后确认和 24 小时过期清理业务引用。
- 服务端重启恢复同一领取、领取凭据和私有候选；排队截止时间过后不再认领。
- PRD 导入不改变 Campaign 验收状态、latestRunId，不产生 Run。

## 最终检查与边界

- `go vet ./internal/api ./internal/handler ./internal/service ./internal/dao ./internal/httpserver`：通过。
- 完整相关包命令：`go test ./internal/api ./internal/handler ./internal/service ./internal/dao ./internal/httpserver -skip '^TestPRDLocalConnectorPublishesForItsOwnUser$' -count=1 -timeout=600s`。api 478.711s，仅上述旧迁移数断言失败；handler/service/dao/httpserver 通过。断言修正后单项通过，未把原完整命令声称为全绿。
- 合并共享 DTO/校验最终版本后：`go test ./internal/api -run '^Test(PRD|LoginMigrationPreservesExistingProjects)' -skip '^TestPRDLocalConnectorPublishesForItsOwnUser$' -count=1 -timeout=180s` 通过（40.746s）。之后增加重复资源引用切片，按表中红绿命令验证，未重复跑整个旧接口组。
- 最终 Go vet 通过；gofmt、`git diff --cached --check` 与仓库暂存检查通过（14 个任务文件），提交 hook 再次通过。
- 真实 Lark 身份/真实 PRD、两台成员电脑、VPS、其他操作系统和发布镜像不由本回执证明。真实 dump/restore 与浏览器由集成任务验证。
