# 04 网页 URL 导入、确认共享与版本阅读

Type: task
Status: ready-for-agent
Blocked by: 01

完整范围见 [spec](../spec.md) 和 [接入合同](../implementation-contract.md)。新增 Campaign PRD 区域、本人连接器在线选择、只填 URL 发起任务、阶段/失败/取消、预览、首次共享勾选、partial 确认、并发冲突提示、当前快照与历史阅读。复用现有组件、Markdown 和资源预览，不加依赖，不改变创建流程或验收结论。补齐 API 客户端 DTO 与中文错误映射。

先读 DESIGN.md；以用户可观察的 Web 交互为 TDD 边界，沿现有 Node 测试方式组织可测试控制器，不用源码字符串断言代替行为。

## Comments
