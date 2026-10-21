# Run 需求归属迁移

仅更正同一 Project 内、尚未绑定任何 Delivery Snapshot 的 Run 归属。不是重新验证或复制报告；Run ID、submissionId、原始提交摘要、报告 JSON、验证时间、保存时间、人审历史及附件字节全部保留。不自动接受、作废或冻结，不合并历史结果。

## API

`POST /api/v1/runs/{id}/move`

```json
{
  "requestId": "stable-request-id",
  "fromCampaignId": "expected-current-campaign-id",
  "toCampaignId": "target-campaign-id",
  "reason": "更正本次验证的需求归属"
}
```

四个字段必填，requestId 最长 200 字节，reason 最长 4000 字节。首次成功返回 201 `{move, run}`；相同请求重试返回 200 和原 move、Run 当前状态，不重复迁移。请求 ID 复用而参数不同返回 409 `MOVE_REQUEST_CONFLICT`。预期来源已变化返回 409 `RUN_CAMPAIGN_CHANGED`，缺失实体返回 404；相同来源/目标或空理由返回 400。

跨 Project 返回 409 `CROSS_PROJECT_MOVE_FORBIDDEN`。任何效力状态的已冻结 Run 返回 409 `RUN_HAS_FROZEN_DELIVERY`；有来源或后续反馈复验关联的 Run 返回 409 `RUN_HAS_FEEDBACK_LINKS`，避免单条迁移拆散同需求反馈链。

Run 归属、迁移记录及两边需求最新轮次/状态在一个事务内保存；失败全部回滚。最新轮次按原成功发布顺序重算，迁入旧 Run 不会覆盖目标已有的较新 Run；空需求回到 pending。移出后原需求可恢复剩余最新完整且已人工接受的状态。此规则只适用于归属更正，不改变删除最新 Run 后回到待审的既有行为。

`GET /api/v1/runs/{id}` 和 Run 列表的 `moves` 为可选、按发生顺序排列的独立归属记录：id、runId、requestId、fromCampaignId、toCampaignId、reason、createdAt。Web 报告信息展示这段记录。报告内的叙述、URL 或附件仍保留验证当时内容。

交付材料中的 Campaign ID 必须等于最初发布需求 ID。平台通过完整迁移链验证当前归属，保留原 manifest、地图、素材及所有 SHA-256；不接受任意历史需求 ID。冻结时绑定当前需求及包含迁移记录的 Run，仍要求当前最新完整范围、人工接受及全部材料门槛。迁移使旧冻结确认 token 过期，不修改任何已有快照、效力事件或文档。

## CLI

```sh
acceptances move-run --run <Run-ID> --from-campaign <原需求-ID> \
  --campaign <目标需求名称或ID> --reason '更正本次验证的需求归属' \
  --request-id <本次稳定请求ID> --repo <已关联业务目录>
```

重复执行同一命令确认未知结果。CLI 回执链接使用 Run 当前需求。原 bundle 的上传重试仍使用最初发布时的 Campaign 参数和原 `.submission-id`；相同内容返回已迁移的同一个 Run，新 Campaign 参数或改动内容继续冲突，不创建伪验证轮次。

数据库升级至 v5，迁移前自动保存一致 SQLite 备份，已有 Run 和评审不做重写。附件继续由 Run ID 寻址，无需复制或重命名。
