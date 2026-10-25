# 01 固定共享协议与任务图

Type: task
Status: resolved
Blocked by: none

依据 [spec](../spec.md) 固定跨服务端、连接器和 Web 的 DTO、URL/资源/版本合同。接口定义见 internal/prd/types.go，接入说明见 ../implementation-contract.md。

## Answer

2026-10-25：协议版本 1，规范化版本 lark-prd-v1-zh-CN；以公开 HTTP API、连接器 CLI/外部 Lark 子进程、Web 交互为已获用户确认的测试边界。用户授权本任务相关本地提交与合并，不授权推送/部署。仅定义类型，无业务逻辑测试。
