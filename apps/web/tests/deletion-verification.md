# Project / Campaign / Run 删除验证

删除状态由 `campaign-run-controller.ts` 持有。Run 删除与 review、void、accept-all 使用同一条 operation 及同一把写锁。页面调用 `controller.deletion(target)` 获取预览、确认、取消和只读核对动作。`deletion-controls.tsx` 负责确认弹窗、结果反馈及可关闭的对象级附件清理提示。

## 模型验证

```sh
node --test apps/web/tests/*test.mjs
```

`deletion-controller.test.mjs` 通过 controller 的公开 interface 验证三类对象的相同行为。它使用内存 adapter，覆盖以下边界：

- 每次 DELETE 都需要新预览与明确确认。取消、重复点击、旧预览回调不会增加写请求。
- `EVIDENCE_CLEANUP_FAILED` 表示数据库已提交删除；警告包含原对象名称，逐项关闭。
- 未知 DELETE 后的 GET 200 只确认对象仍存在，不把写结果改成成功。GET 404 保留未知结果、缺失页和写锁。
- 核对失败可以只重试 GET；相同对象和尝试的并发核对合并。明确的不存在拒绝仍需要核对恢复。
- Run 删除返回后，读取尚未结束时 review、void、accept-all 保持锁定。
- 已删除或已确认缺失的对象不被旧列表重新选中。迟到删除不跳转，也不把其他选择留在加载状态。
- 父级删除被拒绝，不打断独立的 Run 刷新。

## 受控 HTTP 浏览器验证

`deletion-flow.mjs` 导出 `scenarios` 和 `run(page, base, scenario)`，共 30 项。每种对象包含正常删除、附件清理失败、未知结果后缺失或仍存在、核对失败、明确拒绝、不存在拒绝后核对失败、迟到响应、迟到预览和预览失败。

使用机器已有的 Playwright 创建独立 browser，每项再创建独立 context。`base` 指向当前候选 Web 构建的隔离服务。示例中 `browser` 由外部驱动提供，不需要给项目安装 Playwright：

```js
import { run, scenarios } from "./deletion-flow.mjs";
for (const scenario of scenarios) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    console.log(await run(page, base, scenario));
  } finally {
    await context.close();
  }
}
```

这些场景拦截全部 `/api/**` 请求，验证真实浏览器中的点击、弹窗、地址、按钮、列表和警告行为。请求回执必须与通过结果一起保存。它们不证明真实 Go 服务的删除结果。

弹窗关闭后等待 DOM 卸载，菜单关闭后等待关闭动画完成，再发起下一次操作。不要用固定 sleep 或只等待旧侧栏文本来证明新报告已经渲染。

既有回归继续运行 `campaign-run-refresh.mjs` 的全部 29 项，以及 `run-target-navigation.mjs` 的 12 项。刷新套件的 B12 已包含定位套件的 `refresh`，完整执行时其余定位场景再运行 11 项即可。

## 真实 Go 与生产 Web

构建 Web 和 Go server 后，以以下方式启动隔离实例。禁止使用日常数据目录或端口 8765：

```sh
test_dir=$(mktemp -d /tmp/acceptances-deletion.XXXXXX)
build/server --listen 127.0.0.1:0 --data-dir "$test_dir/data" --web-dir apps/web/dist
```

从启动输出取得实际端口。调用前设置 `ACCEPTANCES_TEST_ISOLATED=1`，给浏览器创建独立 context，然后调用 `deletion-real.mjs` 的 `run(page, base, dataDir)`。`dataDir` 必须是上述临时目录内的 `data`。

六项真实场景分别对 Project、Campaign、Run 验证正常 204 和附件清理失败 500。清理失败通过临时取消新测试目录的 evidence 父目录写权限产生；finally 恢复权限并清理该场景的残留目录。没有 HTTP 拦截。每项同时验证浏览器返回位置、数据库对应 GET 404、父级列表或 latest 状态、看板，以及清理警告在整页重载后消失。

`delivery-real.mjs` 还验证通过项目删除确认弹窗保留交付快照、业务说明和复制证据。该套件的 `seed(base)` 要求空数据库，应使用另一套全新临时实例，或先运行它再运行其他真实套件。当前脚本按四步确认交付向导操作。

`campaign-run-real.mjs` 继续验证人工评审、完整及局部范围、刷新、作废、Run 删除、后续复验与重载持久化。

所有真实场景都使用合成的平台测试数据，不代表业务需求验收。调用方保存结果及截图，关闭专用 browser/context，并停止自己启动的服务。
