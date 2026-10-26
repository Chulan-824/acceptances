# Web 导入验证回执

日期：2026-10-25。工作树：`/Users/chulan/.codex/worktrees/lark-prd-web/acceptances`，分支 `codex/lark-prd-web`。

实现提交：`b2aa3ebb44c0427844dda2a94bf3b0c6fbe034f7`。最终 HEAD：`d1dcd6243269a37b168c4ea5638c9760e66e1ebe`，已合并集成提交 `2cd19c4e3586e0601dda35dcfd3818f508caff4c`。最终检查前 Git 工作区干净；本回执为随后新增的未提交材料。

范围限于 apps/web 与 packages/api-client 的 7 个文件。新增 Campaign PRD 区域、本人在线电脑选择、URL 导入、共享提示、轮询/取消、partial 确认、当前版本与历史阅读、重复导入反馈及未知结果/并发冲突恢复。不增加依赖，不修改创建与验收流程。

## 测试边界

新增测试通过页面使用的可观察控制器和实际 API request 函数驱动行为，只替换系统边界 fetch 与浏览器 storage。断言请求、可见状态、失败提示与当前指针，不读取私有函数或源码字符串。这是受控 HTTP 边界证据，未渲染真实 DOM，未连接真实 Go 服务、MySQL 或 Lark。

## 红绿记录

各轮实际执行 `node --test apps/web/tests/campaign-prd.test.mjs`，后期使用 `--test-name-pattern` 单独运行新增场景。

| 增量 | 实际红灯 | 实现后结果 |
| --- | --- | --- |
| 离线导入与 URL 保留 | 模块不存在，测试失败 | 1/1 |
| 选择本人电脑与创建响应丢失恢复 | selectConnector 不存在 | 2/2 |
| 刷新恢复、partial 与确认后读取失败 | 恢复任务为 undefined | 3/3 |
| 并发确认 | conflict 未建立 | 4/4 |
| 取消与晚到读取 | 进行中仍允许重复创建 | 5/5 |
| 确认响应丢失 | confirmUnknown 未建立 | 6/6 |
| 历史阅读与本人断开 | selectSnapshot 不存在 | 7/7 |
| 旧电脑离线后的请求恢复 | 恢复返回 false | 7/7 |
| SAVE_FAILED、刷新失败保留、重叠轮询 | 补充边界组 7 通过/3 失败 | 10/10 |
| 主动清空 URL 后刷新 | URL 被错误回填 | 10/10 |
| partial 复用完整快照 | 缺少完整版本复用说明 | 11/11 |
| 新修订内容未变化 | 缺少内容未变化说明 | 12/12 |
| Lark 个人身份变化 | 只有通用失败提示 | 13/13 |

## 最终检查

以下均在最终 HEAD 执行，退出码均为 0。

- `make test SUITE=web`：125 项通过，其中 PRD 新增 13 项。
- `pnpm -r typecheck`：Web 与 API 客户端均通过。
- `pnpm exec eslint apps/web packages/api-client`：通过。
- `pnpm exec prettier --check` 检查上述 7 个变更文件：通过。
- `pnpm --filter @acceptances/web build`：通过。Vite 提示部分资源块大于 500 kB。
- 实现提交前 `make check-staged`：7 个文件通过，`git diff --cached --check` 通过。

命令按本机 RTK 约定包装。`rtk pnpm -r typecheck` 曾被 RTK 错误改写，随后使用 `rtk proxy pnpm -r typecheck` 原样运行通过。首次沙箱构建因工作树目录写权限 EPERM 未执行成功，经已授权的工作树构建提权后通过。

最终 Web 产物 SHA-256：

- `apps/web/dist/index.html`：`560f5e36fea4d024bfe5d1b6ecf9cd5c255d6cbc6990a1a5ee8d40351c587815`
- `apps/web/dist/assets/app-CgSdYRp1.js`：`e4a99e26fc5ac579b4fa632a5eca89aa845ebf49724792027a33107579607fa6`

未运行真实浏览器、Playwright、Go/数据库测试、双成员跨电脑 Lark/VPS 链路、镜像构建或部署；未读取 .env*、未推送、未操作日常报告。真实页面回归由主 Agent 集成后使用 ego-browser 完成。
