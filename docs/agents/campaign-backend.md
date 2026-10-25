# Campaign 后端样板

本轮只迁移 Campaign 创建、列表、详情和描述修改。接口地址、响应字段和数据库结构保持现有契约；后续修复了 MySQL 重复保存相同描述时误报 404 的问题，具体规则见下文。Run 发布、评审、删除、交付和归档恢复仍由 `internal/api` 实现。

## 职责与依赖

- `internal/handler/campaign.go` 接收 HTTP 请求，调用 Service，并映射响应。使用 Gin；不写 SQL。
- `internal/service/campaign.go` 检查项目存在、标题和描述规则，协调修改与结果读取。只接收 `context.Context`，不依赖 Gin 或 SQL。数据访问接口定义在使用方。
- `internal/dao/campaign.go` 使用 `database/sql` 和参数化 SQL，传递请求 context，区分不存在与读取失败。
- `internal/model/campaign.go` 保存共享 Campaign 结构。旧 `api.Campaign` 通过类型别名保持快照等调用方兼容。
- `api.Server.Register` 装配 DAO、Service、Handler，复用当前连接池和同一个 `s.mu`。修改描述和读取结果共同持有该锁，不能给新旧模块各建一把锁。

Service 使用结构化依赖注入；不通过 `gin.Context` 存取数据库，不为每个结构体创建接口。DAO 不决定业务状态，Handler 不接管业务规则。

## HTTP 过渡入口

四个接口及其 GET 对应的 HEAD 请求交给 Gin，其他方法和路径仍由原 `ServeMux` 分发。外层 `Guard` 对所有请求执行 Host、Origin、MySQL 租约和归档目录生命周期检查。

Gin 关闭额外路径重定向，使用 `URL.EscapedPath` 匹配；参数继续取外层 `Request.PathValue`，保持标准库按段解码的行为。对 `/%63ampaigns/` 这类被外层 ServeMux 识别的编码写法，Gin 的 fallback 按已经匹配的 `Request.Pattern` 调用同一个 Handler。保留原健康检查、SPA 和 API fallback，包括完整服务器与 `api.Server.Handler` 原有的方法错误差异。

`handler.DecodeJSON` 与响应函数由新旧 Handler 共用。请求体最多 1 MiB，拒绝未知字段和多个 JSON 值，响应继续使用现有 `{code,message}` 格式。创建请求仍优先报告项目不存在；修改请求先校验描述是否提供，再查目标。

## 业务约束

- 标题必须包含非空白字符，保存时保留原文。
- 新 Campaign 为 `pending`，`latestRunId` 为空。
- 描述修改区分缺失、`null` 和空字符串；空字符串有效，上限是 65,536 字节。
- 修改只更新当前 Campaign 的描述，不改变状态、最新 Run、报告、人工判断或冻结快照。
- 描述更新成功后读取目标记录：存在则返回 200（包括重复保存相同描述），不存在才返回 404。不能用更新行数判断存在性，MySQL 同值更新的实际修改行数为零。

## 验证

命令和证据边界以 [工具链指南](../toolchain.md) 为准。

`SUITE=http` 覆盖 `api`、`handler`、`service`、`dao`、`httpserver`。Service 测试覆盖业务边界、错误原因和并发结果；DAO 测试使用实际迁移生成的隔离 MySQL 数据库；HTTP 测试覆盖真实入口、HEAD、编码路径、fallback 和请求保护。

`SUITE=mysql` 包含相同 Campaign 契约、原始描述及普通/空/最大长度描述的重复保存、历史不可变及租约丢失后四个接口拒绝访问的检查。每个测试创建专用数据库。数据库集成沿用项目当前测试分组，不额外引入 build tag。

共享锁装配回归使用 `Server.Handler()` 的真实注册入口，在 MySQL 上交错执行旧模块的 Campaign 删除/最新 Run 批量接受与描述 PATCH。测试暂缓旧接口响应：此时事务已提交，旧 Handler 仍持有共享锁，避免数据库锁掩盖错误装配；PATCH 必须等待，并在释放后返回删除后的 404，或同时保留新描述与已接受状态。同步屏障仅存在于测试的请求体和 ResponseWriter 中，没有业务测试钩子。若以后调整旧 Handler 的锁范围，应同步调整屏障位置，继续验证新旧模块的互斥关系。

Web 已提供创建需求表单，CLI/API 创建入口继续保留；尚无编辑描述表单。登录后由请求上下文记录创建用户，Handler 不接收调用方指定的作者。浏览器验证应覆盖真实表单创建、导航、刷新及历史报告显示。
