# Campaign / Run 真实服务验证

`campaign-run-real.mjs` 导出 `run(page, base, apiBase = base)`。调用者提供外部 Playwright 的专用 Page、当前候选前端地址和隔离 Go 服务地址。驱动不拦截请求，不引入测试依赖。

**仅允许连接专门建立的临时数据目录和端口。** 驱动创建带时间戳的 Project、Campaign 和 Run，操作及删除这些 fixture，保留剩余数据供核查。不能传入日常服务地址。调用者记录候选 HEAD、构建、端口、数据目录和驱动指纹，再运行。

```js
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
try {
  console.log(await run(page, frontendBase, isolatedAPIBase));
} finally {
  await context.close();
}
```

通过真实 HTTP 创建测试前置数据；逐项通过、不通过、撤回、整轮评论、一键交付、Void 和删除均从实际页面操作。每次操作等待对应写响应和页面发起的 Run 回读，再通过 API 核对持久状态。未使用内部状态或 SQLite 断言。

| ID  | 覆盖                                                                                |
| --- | ----------------------------------------------------------------------------------- |
| H01 | 人工通过、不通过、撤回、整轮评论、一键交付；Run/Campaign 状态、历史数量、原报告不变 |
| H02 | full、partial、unknown 范围；新 Run 待审；历史 Run 改判不改变 latest Campaign       |
| H03 | 上传新 Run 后手动刷新保留当前报告；点击新记录入口后才切换                           |
| H04 | Void 只能评论；删除 latest 不提升历史；删除后续和来源 Run 后真实链接状态与页面回读  |
| H05 | 离开后重新进入、整页刷新，历史评论和判断仍能回读                                    |

成功返回每个场景的 `passed` 和 fixture ID；任何失败抛错，由调用者将运行标为失败并保存请求日志、错误和必要截图。不能因前序检查通过而把后续未执行的场景计为通过。这些场景验证前后端协作与持久化，不代表用户接受实际业务 Evidence，也不验证跨页面重载的内存操作锁。
