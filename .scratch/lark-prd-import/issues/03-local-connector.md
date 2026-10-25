# 03 成员本机连接器与 Lark 读取

Type: task
Status: ready-for-agent
Blocked by: 01

完整范围见 [spec](../spec.md) 和 [接入合同](../implementation-contract.md)。实现 acceptances lark connect，在仓库关联解析前独立分发。复用平台登录，主动轮询本人任务、续租、固定 profile/个人身份、同修订 XML/Markdown、评论剔除、图片/画板获取、缺口清单、manifest、回传和安全错误处理。实现 internal/prd 的 URL 规范化与 Bundle 验证，供服务端共用。不得读取 .env* 或上传凭据。

以公开连接器 CLI + 受控 Lark 子进程/测试 HTTP 服务做 TDD，不访问个人文档做默认测试。CLI 信号取消、断网、版本变化、profile 变化、坏结果与重试必须可验证。

## Comments
