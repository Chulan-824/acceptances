# 本机 Lark 连接器验证记录

本记录整理本轮实际工具输出，供工作树清理前归档。测试通过公开 `cli.Run` 的独立进程、受控外部 `lark-cli` 可执行文件和临时 HTTP 服务观察行为；共享协议测试使用 `prd_test` 外部包调用导出接口。不访问实际个人 PRD，不发起新授权。

## 代码与环境

- 工作树：`/Users/chulan/.codex/worktrees/lark-prd-connector/acceptances`。
- 分支：`codex/lark-prd-connector`。
- 最终 HEAD：`6cb9c88a31205941016c8a17e2ac055e8a36fe81`，已合并最终服务端集成 tip `a7d348ee9dd37602395fd9ff06ac4df133b4f819`。
- URL 协议提交：`cea4aa1`；Bundle/XML 协议提交：`0e62318`；分组引用与资源读取时间：`74472c2`；完整 CLI：`159e675`。
- 本机 Go `1.26.8`、Node `26.7.0`。受控 Lark 版本输出固定为 `lark-cli version 1.0.98`，JSON 形状按已查证的该版本公开接口构造。
- 本回执新增前工作树干净。该回执按归档要求新增，不提交。

## RED→GREEN 切片

| 公开行为 | 实际 RED | 修正与 GREEN |
| --- | --- | --- |
| URL 规范化 | 测试先因尚无 `NormalizeURL` 导出符号编译失败 | 实现受限 HTTPS Docx/Wiki URL，去 query/fragment，拒绝伪域名、userinfo、非默认端口及其他资源；`go test ./internal/prd` 通过 |
| 双格式上传包 | 测试先因尚无 `ValidateBundle` 导出符号编译失败 | 校验结构/阅读视图、版本、文件摘要、MIME、声明与实际文件、完整性；公共协议测试通过 |
| 临时别名去重 | `TestBundleDeduplicatesTemporaryAliasesAndReadMetadata` 失败，临时引用别名改变资源语义摘要 | 资源摘要去除传输别名、文件名和读取时间；测试通过 |
| 分组引用 | `TestBundleResolvesAliasesWithinTheirReferenceGroup` 报 `group alias resolution was nondeterministic` | 按元素和引用组确定属性，歧义拒绝；重复验证摘要一致，测试通过 |
| 评论与链接 | `TestDocumentExcludesCommentsAndTransientMediaURLsButKeepsLinks` 失败，普通链接 URL 被一同删除 | 只移除媒体临时地址，保留普通链接和正文；测试通过 |
| 媒体别名碰撞 | `TestDocumentKeepsBothMediaGroupsWhenAliasesCollide` 只得到一个资源 | 保留图片与画板两个资源并区分引用；测试通过 |
| 无仓库运行连接器 | `TestLarkConnectImportsWithPersonalCLIOutsideRepository` 先失败，日志为 `unexpected positional arguments` | 在仓库关联解析前分发 `lark connect`；受控 CLI 读取、清理评论、multipart 上传并通过同款 Bundle 校验 |
| 阅读视图代码保真 | `TestLarkConnectPreservesCodeDuringReadingViewCleanup` 失败，围栏代码和行内代码中的图片示例被替换为缺失提示 | 资源改写跳过围栏代码和 backtick span；该测试通过，单次回执 3.479 秒 |
| 上传与心跳竞争 | `TestLarkConnectRecognizesReadyCandidateWhenUploadHeartbeatConflicts` 失败，25 秒内未读取已保存候选状态 | heartbeat 409 或上传结果不明时读取本人 Import；同 attempt 的 ready/confirmed 视为成功，不上送失败；该测试通过，单次回执 17.132 秒 |

其余公开 CLI 覆盖包括 Wiki→Docx、PNG/画板下载、无 token 外链不请求、缺失与不支持资源清单、换账号停止、修订持续变化三轮后失败、坏 schema、权限拒绝不重试、限流重试、上传连接中断后恢复、忙碌续租、409 取消、信号退出和临时文件清理。这些是已通过的覆盖项，不额外声称每项都有单独保存的 RED 输出。

首次尝试临时 HTTP 测试时，受限沙箱拒绝监听端口，报 `httptest: failed to listen on a port`。随后在获准的隔离监听环境重新执行，才得到上表的行为 RED；监听权限失败不算产品行为证据。

## 普通测试

下列命令在上述工作树执行，缓存复用主工作区已安装依赖：

```sh
GOCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-build \
GOMODCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-mod \
go test ./internal/prd ./internal/cli -count=1
```

结果通过。该次输出为 `internal/prd 0.272s`、`internal/cli 68.833s`。后续 agent 补检再次运行完整 CLI，结果为 `70.325s`，覆盖最终 CLI 实现。共享引用解码随后只做了一次解析复用，公共协议测试另行通过，输出 `internal/prd 0.299s`。

静态检查通过：

```sh
GOCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-build \
GOMODCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-mod \
go vet ./internal/prd ./internal/cli
```

限定路径提交的 `git diff --cached --check` 和仓库提交 hook 均通过。hook 只证明暂存格式检查，不代替测试。

## race 检查

首次对两包完整运行 race：

```sh
GOCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-build \
GOMODCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-mod \
GORACE=atexit_sleep_ms=0 \
go test -race ./internal/prd ./internal/cli -count=1
```

这次未通过。`internal/prd` 通过；受控子进程启动变慢，多个 CLI 测试超过原有 10/15/20 秒等待上限，CLI 包输出 `175.879s`。输出中未出现数据竞争诊断，不能将这次失败写成 race 检查通过。

测试进程等待上限调整为 90 秒，生产的 15 秒轮询/心跳和 90 秒租约未随之增加。随后对关键并发路径执行：

```sh
GOCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-build \
GOMODCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-mod \
GORACE=atexit_sleep_ms=0 \
go test -race ./internal/prd ./internal/cli \
  -run 'TestBundle|TestURL|TestDocument|TestLarkConnectResolves|TestLarkConnectRecognizes|TestLarkConnectCancels|TestLarkConnectPreserves' \
  -count=1
```

结果通过，输出 `internal/prd 0.293s`、`internal/cli 116.808s`。这覆盖共享协议、资源读取、代码保真、上传/心跳竞争和取消退出；完整 race 全集未在延长等待阈值后重跑。

## 仓库 agent 补检

首次执行 `make test SUITE=agent` 未通过。工作树默认的新 Go module cache 触发下载，`proxy.golang.org` 的 MySQL 驱动、Gin、UUID、x/crypto 下载出现 TLS handshake timeout，失败发生在 `go build`，未进入测试。

改用已有缓存执行原补检入口：

```sh
make test SUITE=agent \
  GOCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-build \
  GOMODCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-mod
```

复跑通过，包括 CLI 构建、安装器隔离测试 1 项、Jev 离线测试 7 项、完整 CLI Go 测试。安装器测试不替换日常 CLI；Jev 测试不连接 Chrome 或模型。

原始机器回执位于 `artifacts/agent.json`。本轮关键字段如下，避免清理工作树后只剩路径：

```json
{
  "suite": "agent",
  "startedAt": "2026-10-25T16:01:43.056Z",
  "endedAt": "2026-10-25T16:03:01.843Z",
  "outcome": "passed",
  "environmentClass": "isolated-helper-and-go"
}
```

## 最终合并后的编译

合并最终服务端 tip 后执行：

```sh
GOCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-build \
GOMODCACHE=/Users/chulan/project/my-project/acceptances/.cache/go-mod \
go test ./internal/prd ./internal/cli -run '^$'
```

结果两包均通过，分别为 `0.225s`、`0.542s`，均标明 `no tests to run`。这是最终 HEAD 的编译验证；合并后没有再重复长测试。最终服务端的真实 HTTP/MySQL 联调由主任务另行记录。

## 证据边界

- 本记录证明本机受控外部进程与平台协议的实现行为，不证明真实 Lark 文档内容、权限或渲染完整性。真实表格、图片、评论及复杂文档需逐项对照原文。
- 本任务未执行 VPS 部署、双成员电脑或生产网络验收，未访问实际个人 PRD、发起新 Lark 授权、推送代码或安装系统服务。
- Unix 使用独立子进程组取消并等待退出；公开 CLI 测试覆盖本机取消和清理。非 Unix 当前仅取消直接子进程，进程树取消未保证、未验证；代码中已保留升级前提注释。不能据此宣称 Windows 完整取消已支持。
- 本轮最终提交前的测试包含未提交工作树实现；最终 HEAD 又合入服务端。上文分别列出行为测试、race 选择范围与最终编译，未将它们合称为对最终 HEAD 的完整产品验收。
- 受控 fixture 位于 `internal/cli/lark_test.go` 的 `TestLarkFixture`；其 profile/auth 返回裸 JSON，文档/Wiki/media 使用 `ok/identity/data` 信封。注册后 ready 事件只含设备选择所需字段，不输出 token、读取人 openId 或原始认证错误。
