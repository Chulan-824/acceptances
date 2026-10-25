---
status: accepted
---

# 个人 Lark 授权留在成员电脑，平台保存确认后的共享 PRD 快照

2026-10-25，用户确认接受每位成员先登录平台 CLI，并在导入时保持本机连接器在线。网页提交 Lark URL，连接器主动通过 HTTPS 向 VPS 领取本人发起的任务，以本机已授权的个人 Lark CLI 读取并回传内容。用户随后授权本地实现，工程验证与真实环境边界分别记入[集成回执](../../.scratch/lark-prd-import/integration-verification.md)和[外部验收交接](../../.scratch/lark-prd-import/external-acceptance.md)。

本方案保留个人读取身份，同时不要求 VPS 主动访问成员电脑。服务端逐用户 OAuth 会改变本机授权前提；共享账号不符合用户要求；浏览器直接调用本地端口需要额外的本地服务与浏览器通信配置，本期均不采用。个人 Lark 凭据不上传平台，不进入公共镜像。

用户确认导入内容沿用 [ADR-0013](0013-team-project-access-and-stable-users.md) 的全员共享规则，并在首次导入时提示导入人。Lark 原文后续撤权或删除不会自动清除已确认的平台快照。读取任务与待确认内容只交给发起人的连接器和账号，确认后成为共享业务资料；这不新增角色或项目授权。

完整调研证据、接口草案、实施顺序与待验证项见[实施设计](../../.scratch/lark-prd-import/spec.md)。本 ADR 不表示真实 PRD 抓取、连接器联调或 VPS 部署已经通过。
