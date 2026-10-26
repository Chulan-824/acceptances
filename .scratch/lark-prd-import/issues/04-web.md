# 04 网页 URL 导入、确认共享与版本阅读

Type: task
Status: resolved
Blocked by: 01

完整范围见 [spec](../spec.md) 和 [接入合同](../implementation-contract.md)。新增 Campaign PRD 区域、本人连接器在线选择、只填 URL 发起任务、阶段/失败/取消、预览、首次共享勾选、partial 确认、并发冲突提示、当前快照与历史阅读。复用现有组件、Markdown 和资源预览，不加依赖，不改变创建流程或验收结论。补齐 API 客户端 DTO 与中文错误映射。

先读 DESIGN.md；以用户可观察的 Web 交互为 TDD 边界，沿现有 Node 测试方式组织可测试控制器，不用源码字符串断言代替行为。

## Comments

- 2026-10-25：由 implement_web 在独立工作树实现，基点 4ebe9ed。

## Answer

实现提交 `b2aa3eb`，工作分支最终 `d1dcd62`，通过独立 merger 合入 `2cdaf2e`。125 项 Web 测试（新增 13 项 PRD）、类型、ESLint、格式与生产构建通过。真实页面由 05 集成验收，受控测试不能替代真实 Lark/VPS。

验证细节：[web-verification](../web-verification.md)。
