---
name: acceptance-cl
description: >
  创建、校验、封存并展示本地 .acceptances Round，交给人逐项接受或拒绝。
  用于明确的 acceptance-cl、本地验收、验收 Round 或打开本地交付页请求；
  普通测试、lint、构建和测试报告不触发完整 Round 流程。
---

# 本地验收

你是 Round builder。交付物是磁盘上的新 Round、validator Receipt、本地 catalog 登记和可供人审的页面。口头测试结论不能替代 Round。

完整回路：

```text
项目适配层 → 验收计划 → 证据 → Draft Round → 校验封存 → 登记 → 本地页面 → 覆盖率
```

用户只要求打开已有 Round 时，直接执行“登记和展示”。

## 定位 CLI

本 skill 的 `scripts/acceptances-cli.mjs` 是 CLI 解析器，不包含 validator 或 renderer 实现。先根据当前 `SKILL.md` 的位置取得脚本绝对路径，再验证：

```bash
node <skill-dir>/scripts/acceptances-cli.mjs --help
```

解析器依次使用：

1. `ACCEPTANCES_CLI` 指向的 `bin/cli.js`。
2. 与仓库内本 skill 同版本的 `bin/cli.js`。
3. `PATH` 中已安装的 `acceptances` 命令。

三者都不可用时停止，不创建 Round。向用户说明需要安装 Acceptances CLI、从仓库符号链接本 skill，或设置 `ACCEPTANCES_CLI`。

后续命令中的 `<runner>` 均表示这个脚本的绝对路径。

## 读取项目适配层

在待验收项目根目录工作。若存在 `.agents/acceptance/PROJECT.md`，先读它；仅在文件存在时继续读取同目录的 `PROCESS.md` 和 `common-mistakes.md`。

适配层负责项目的启动命令、已有服务、页面入口、认证方式和测试数据。复用用户已经运行的服务，只停止本轮自己启动的进程。

认证失败、跳到登录域或业务接口返回 401/403 时，暂停页面操作。按适配层约定请求用户完成登录或提供会话材料。只记录脱敏后的 URL、host 和状态码，不输出或保存凭据。适配层没有安全注入流程时，请用户手动登录。

完成标准：项目适配文件已经读完，或者确认它们不存在并据此采用普通本地验证方式。

## 写验收计划

驱动产品前写 `plan[]`。每项必须描述人能判断的产品结果，并包含 `id`、`title`、`category`、`method`、`expected` 和 `requiredEvidence`。

类型检查、lint、单元测试、构建和 CI 是工程门禁，只在 `report.md` 记录，不作为验收检查项。

完成标准：每个计划项都有可观察的期望结果和所需证据介质。

## 收集证据

使用能直接证明计划项的最低成本介质。CLI 行为优先保存脱敏文本；网页行为使用当前环境可用的浏览器工具。引用图片前必须实际查看图片内容。

证据写入当前 Round 的 `assets/`。文本和 payload 移除 `Authorization`、cookie、token 及同类凭据。不要保存原始 HAR 或环境文件。

完成标准：每个计划项声明的必选介质都已写入磁盘，并且能直接支持观察结论。

## 创建 Draft Round

第一次写 Round 前读取 [references/round.md](references/round.md)。为本次验证创建新目录：

```bash
new_round() {
  round_dir=".acceptances/$1/$(date +%Y%m%d-%H%M%S)-$2"
  mkdir -p "$round_dir/assets" && printf '%s' "$round_dir"
}
REPORT_DIR=$(new_round <subject> <round-slug>)
```

同一交付的后续验证沿用 Subject，但创建新的 Round。Draft 可以修正作者错误；Published Round 的修复必须创建下一轮。

`cases[].status` 只记录跑测结论。人工 overlay 留给页面写入 `reviews.json`。

完成标准：新目录包含 `result.json`、`report.md` 和 `assets/`，每个 `pass` 或 `fail` case 至少引用一份证据。

## 校验和封存

```bash
node <runner> validate "$REPORT_DIR" --seal
```

Validator 不改写 Raw Round。`ready` 和 `held` 会写入 Receipt；`rejected` 不封存。`held` 只能交付为未闭合，不能描述成验收通过。

完成标准：结果不是 `rejected`，并且 `.acceptances/.meta/<subject>/<round>.json` 已存在。

## 登记和展示

在待验收项目根目录登记 `.acceptances/`：

```bash
node <runner> register "$PWD"
```

先检查 `http://127.0.0.1:8765/api/health`。未返回 `{"ok":true}` 时，在可持续运行的终端会话中启动：

```bash
node <runner> serve
```

服务启动后再次检查 health 和目标 Subject 页面。服务只监听 `127.0.0.1`，不要通过代理或端口转发把它暴露到公网。

完成标准：catalog 中存在当前项目，页面能够读取新 Round 或用户指定的已有 Round。

## 交付覆盖率

对照计划计算 `coverage: N/N`。分子要求计划项已有 case，且所有 `requiredEvidence` 都存在。最终回复包含覆盖率、validation outcome 和 `http://127.0.0.1:8765` 下的页面 URL。

不要在回复中粘贴凭据、原始 payload、Round 绝对路径或证据文件内容。

完成标准：用户拿到可访问的本地页面，且能区分机器跑测结论、validator outcome 与人工审核状态。
