# Run 定位浏览器验证

## 检查项通过后连续审查

`check-review-flow.mjs` 导出 `run(page, base, output)`，使用真实 Go API 和生产 Web。调用前设置 `ACCEPTANCES_TEST_ISOLATED=1`，以全新临时数据目录和随机本机端口启动服务，并创建专用 Playwright context。测试拒绝日常端口 5173、8765，且要求初始项目列表为空；不新增测试依赖。

覆盖通过后收起、跳过已通过项、定位并展开下一待审或不通过项、末尾回跳、保留搜索与两种筛选、筛选内全部通过提示、隐藏通过项三个按钮及撤回恢复。另用受控 HTTP 故障验证拒绝和结果未知保留草稿，以及回读延迟、失败重试前不跳转。定位检查标题是否避开顶部固定标签栏和底部评审栏。提供 `output` 时保存截图，返回各场景结果；失败抛错，由调用方关闭浏览器和专用服务。结果仅证明平台合成交互。

## 正式交付与离线业务说明

`delivery-real.mjs` 导出 `seed(base)` 和 `run(page, base, output, fixture)`，连接真实 Go API 与当前生产 Web，使用专用 Playwright context。调用前设置 `ACCEPTANCES_TEST_ISOLATED=1`，在 `127.0.0.1` 随机端口启动带全新临时数据目录的服务。seed 要求项目列表为空并拒绝日常端口 8765，创建的合成项目可被删除。

场景包含独立冻结确认、异常项理由、HTML 生成及独立版本、sandbox 预览、改判失效、来源删除保留、窄屏归档与断网离线图片。产出 JSON 回执、截图和下载 HTML；失败抛错，调用方须在 finally 关闭 browser。使用机器已有 Playwright，不安装新依赖。它只证明平台合成流程，不代表业务需求验证通过。

## 既有定位回归

`run-target-navigation.mjs` 导出 `run(page, base, scenario)`，接收外部 Playwright 的真实 Page；不引入新测试依赖。`base` 默认 `http://127.0.0.1:15173`，需先在隔离端口启动 Vite。测试会拦截该 browser context 中所有 `/api/` 请求，使用内存中的 Project、Campaign、两个 Run 和 Feedback Response。它验证浏览器行为，不证明 Go 服务或日常数据的行为。

有外部 Playwright 驱动时，导入此文件，然后对专用 Page 分别调用 `run(page, base, "invalid")` 和 `run(page, base, "repeat")`。测试结束由调用者关闭专用 context。

Playwright MCP 的 `browser_run_code_unsafe` 也可运行：读取文件文本，将 `export async function run` 替换为 `async function run`，包在 `async (page) => { ...; return run(page, "http://127.0.0.1:15173", "invalid"); }` 中，通过 `code` 参数执行。重复定位场景改为 `repeat`。VM 不要求 Node 内置模块，也不依赖动态 import。不要对日常浏览器 context 使用该脚本。

核心 TDD 记录（2026-10-12）：

- invalid：先在既有实现打开 `second#check-missing`，等待缺失提示超时（Red）。引入定位 module 与恢复入口后，缺失目标、恢复、无法解码 hash 均通过（Green）。
- repeat：已有集中定位实现下，重复点击关联 Check Item 后断言历史长度失败（Red）。链接跳过相同 URL 的历史写入、仍触发定位后，通过重复展开、筛选清空与前进后退场景（Green）。
- 场景均断言导航没有发出任何写请求。

完整场景可在同一个专用 Page 中依次执行：

```js
for (const scenario of [
  "invalid",
  "repeat",
  "cross",
  "targets",
  "recovery",
  "loading",
  "stale",
  "failure",
  "deleted",
  "native",
  "missing-viewport",
  "refresh",
]) {
  console.log(await run(page, "http://127.0.0.1:15174", scenario));
}
```

未知场景名会抛错，不会产生未执行但通过的结果。调用方应让抛出的错误导致验证失败。Vite 必须服务当前待验证 worktree；默认端口也可通过 `base` 覆盖。

| 场景     | 可观察行为                                                                                     | 对应 User Stories |
| -------- | ---------------------------------------------------------------------------------------------- | ----------------- |
| invalid  | 缺失 Check Item、无法解码 hash、报告保留与恢复                                                 | 22–24             |
| repeat   | 再次折叠后重复定位、搜索和结果筛选一起清空、历史不增长、后退前进                               | 1、3–6、16–19     |
| cross    | 来源 Check Review、后续 Check Item、整轮 Review、无关联检查项的处理说明、正确 Run 内容与标签   | 8–13              |
| targets  | 深链接、两层折叠 Review 展开、hash 变更、Evidence、底部按钮保持 URL、键盘 Enter 和真实前进后退 | 2、7–10、19、21   |
| recovery | 未知目标、概览顶部、历史替换、后退前进不重现无效目标                                           | 22–25             |
| loading  | 暂缓来源 Run 响应，加载中无缺失提示，释放后展示正确反馈                                        | 14                |
| stale    | 暂缓来源 Run，后退切换整轮讨论，再释放旧响应；当前 Run 和标签不变                              | 15                |
| failure  | 服务端读取失败保留错误且不报目标缺失                                                           | 26                |
| deleted  | 来源已删除保留提示且没有来源链接，默认检查清单                                                 | 27                |
| native   | 本轮与跨 Run 链接的修饰事件未被拦截，真实 Cmd/Ctrl 新标签打开，不带目标链接默认展示            | 20、27            |

除 `refresh` 外，每个场景都断言没有 HTTP 写请求（故事 28）。`refresh` 只允许用户明确点击的那一次 Review POST，用其成功回读触发普通快照刷新，并断言导航没有增加写请求。故事 29 是源码职责审查，故事 30 由上述浏览器 seam 支持，不能仅靠运行通过证明架构质量。

viewport 检查等待目标实际可见，并检查目标顶部在固定评审栏之上；允许浏览器滚动取整造成的 1 px 偏差。加载与迟到响应通过显式释放 HTTP 响应并等待响应完成控制，不用固定 sleep 判断加载结束。native 的全修饰键矩阵检查事件未取消，是实际新标签测试的补充，不声称每种系统快捷键都真实打开过窗口。

2026-10-12 第一轮完整回归：10 个场景在 worktree 02 的 Vite 15174 全部通过。新增测试未发现需修改产品实现的问题；首跑 cross 因浏览器目标 top=-0.203125px 被严格零容差误判，调整测试为 1 px 容差后通过。这不是产品故障的 Red/Green 证据。上面的 invalid/repeat 是 ticket 01 已记录的产品 Red/Green。

审查后新增 `missing-viewport`：从下方 Check Review 改为未知 hash，要求缺失提示及恢复按钮进入 viewport，再恢复概览。旧实现等待提示进入 viewport 超时（Red）；定位 module 接收提示的 ref 并将它纳入既有滚动生命周期后通过（Green）。真实服务也先复现了提示 top=-265.90625、bottom=-127.90625，证明此前 DOM 可见断言遗漏了窗口外的提示。

2026-10-13 刷新生命周期回归新增 `refresh`：从 `#check-target` 进入，明确提交一次评审，在响应暂缓时折叠目标并滚回顶部，然后释放写响应和 Run 回读。断言目标保持折叠、滚动位置不变；再次点击相同目标链接仍展开并定位。旧实现失败于 `Ordinary refresh must preserve collapsed target`（Red）；按 Run、定位意图和目标可用性记录已完成定位后通过（Green）。定位只有实际执行滚动后才完成，加载中的目标与被取消的动画帧仍可继续处理。

本次 12 个场景通过独立 headless Chrome 和 15176 隔离 Vite 执行；HTTP 为受控 fixture，不代表真实 Go 接口验收。调用方可以从环境提供的 Playwright 包导入 `chromium`，创建独立 browser/context/page，运行上面的场景列表，并在 finally 关闭 browser。无需修改项目依赖。

## Campaign / Run 刷新交互

`campaign-run-refresh.mjs` 导出 `scenarios` 和 `run(page, base, scenario)`。每项使用独立 Playwright browser context 和当前候选 Vite；所有 `/api/**` 均由受控 HTTP fixture 响应，不连接日常数据库。当前共 29 个场景，单独验证父级缺失重试时调用 `run(page, viteOrigin, "B15-parent-missing-retry")`。未知场景名直接失败。调用方为每项设置整体超时，失败不得记为 passed，并在 finally 关闭 context。

```js
import { run, scenarios } from "./campaign-run-refresh.mjs";
for (const scenario of scenarios) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    console.log(await run(page, viteOrigin, scenario));
  } finally {
    await context.close();
  }
}
```

| 清单 | 场景名                                                                                 | 可观察断言                                                                                    |
| ---- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| B01  | `B01`                                                                                  | 仅提交表单清空；另一表单草稿保留                                                              |
| B02  | `B02`，`B13-campaign`                                                                  | Run / Campaign 回读失败不卸载草稿，重试仅 GET                                                 |
| B03  | `B03`                                                                                  | 提交响应丢失，草稿与未知结果提示保留，GET 后恢复操作                                          |
| B04  | `B04`                                                                                  | Review、评论、交付、Void、删除共锁；Tab/折叠可用；外围慢不延长锁                              |
| B05  | `B05`                                                                                  | Tab、折叠和同 Run 草稿在刷新后保留                                                            |
| B06  | `B06`                                                                                  | latest 变化保留当前报告且不展示历史提示，从运行记录切换后新 Run 不继承草稿                    |
| B07  | `B07-empty`、`B07-latest`、`B07-history`、`B07-explicit`、`B07-loading`、`B07-failure` | 首次选择、空态、显式缺失、列表加载/失败及重试                                                 |
| B08  | `B08`                                                                                  | 提交中跨 Run、首页、其他 Project 返回仍锁定，旧回调不影响新页面                               |
| B09  | `B09-empty-default`、`B09-history`、`B09-latest`                                       | 影响预览与删除确认；默认地址、历史与 latest 恢复                                              |
| B10  | `B10-late`、`B10-external`、`B10-external-default`                                     | 迟到删除不拉回；外部删除保持地址并提供恢复                                                    |
| B11  | `B11-cleanup`、`B11-unknown`、`B11-unknown-present`、`B11-unknown-read-failure`        | 清理警告；未知删除后 404、200、读失败，均不重发 DELETE                                        |
| B12  | `B12` + 本文既有 11 项定位场景                                                         | `B12` 调用 `refresh` 定位场景，保留真实 viewport 与重复定位断言；前进后退等由既有定位回归覆盖 |
| B13  | `B13-campaign`、`B13-runs`、`B13-campaigns`                                            | 三类外围失败保留旧数据并提示，当前 Run 解锁且历史列表详情一致                                 |
| B14  | `B14`                                                                                  | 搜索隐藏检查项后，交付确认仍展示全部数量、人工不通过与原始异常项                              |
| B15  | `B15-parent-missing-retry`                                                             | 父级 404 后，500 / 网络失败仍保持缺失与禁写；同一父级 GET 200 后恢复，全程 0 写请求           |

场景返回请求顺序和写请求信息供保存证据。写入和读取顺序通过显式响应释放控制；驱动结果仅证明受控 HTTP 下的真实前端行为。真实 Go 验证另见 [campaign-run-real.md](campaign-run-real.md)。
