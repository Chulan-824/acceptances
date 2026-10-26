# 按人工反馈修复与复验

用户在业务聊天中明确要求读取反馈后执行此流程。Acceptances 保存评论和人工判断，执行仍由业务目录中的 Agent 完成。

## 读取与选择处理范围

```sh
acceptances feedback --campaign <标题或ID>
acceptances status --run <来源RunID>
```

`feedback` 返回该 Campaign 历次 Run，`status` 返回指定 Run。使用用户指定的来源 ID，核对 `campaignId`、报告、证据及以下字段：

| 字段                     | 用途                                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| `report.checks[].status` | 当次 Agent 的原始验证结果                                                  |
| `checkReviews[]`         | 每个检查项当前的人工状态及 `lastReviewId`                                  |
| `reviewCounts`           | 本轮待审、人工通过、不通过的数量                                           |
| `reviews[]`              | 历次判断、撤回及评论，包含反馈 `id`、`checkId`、`kind`、`body` 和 `legacy` |
| `report.scopeType`       | `full`、`partial` 或 `unknown`；缺失按未知读取                             |
| `report.followUp`        | 本 Run 响应的来源 Run 和反馈                                               |
| `feedbackResponses[]`    | 后续 Run 对本 Run 反馈的响应，可用 `runId` 读取复验报告                    |
| `sourceRunAvailable`     | 有 `followUp` 时表示来源 Run 是否仍存在                                    |

当前人工状态以 `checkReviews` 为准，评论和旧规则下的整轮评审不参与状态计算。`legacy: true` 的旧接受、拒绝仅提供历史背景。判断事件按保存顺序计算，Agent 不通过随机 ID 或相同时间戳排序重新推断当前判断。

结合本次指令选择处理项：

- 当前人工不通过的项，即使原始验证为 `passed`，也要按理由处理。
- 当前人工通过的项，即使原始验证为 `failed`、`blocked` 或 `skipped`，也不因原结果自动要求修复。用户指出新的问题时按本次指令处理，保留原结果和人工理由。
- 逐项或整轮评论可以指出新问题。评论本身不改判；新行为在后续实际验证中增加检查项。
- 待审表示尚未作出当前人工结论。按本次验证范围处理，不将待审写成不通过或通过。

每条需要处理的反馈记录其 `id` 和原文，并说明处理方式。验证指令只授权验证；业务代码修改以用户明确的修复指令为准。未授权修复时先完成可执行验证并报告问题。

## 修复与实际复验

按业务仓库规则完成已授权修改，执行针对问题的验证及受改动影响的回归。报告分别记录实际 `passed`、`failed`、`blocked`、`skipped`，静态检查、模拟和真实页面/API 证据分别描述。

新 bundle 按 [报告格式](report.md) 填写 `followUp.sourceRunId`，为本次选择处理的每条反馈填写一个 `responses` 元素：

- `reviewId` 使用来源 Run 中真实反馈的 `id`，逐项反馈和整轮评论均可作为来源。
- `explanation` 写明修改、无需改动的原因、实际复验结果或阻塞。未处理或受阻也如实说明。
- `checkIds` 关联新报告中的实际检查项，可关联多项。未执行本次检查、无需改动或受阻时可为空，原因须写入说明。

同一报告中，同一反馈只填写一个响应；来源必须属于同一 Campaign，本次检查项 ID 必须存在且不重复。行为相同可复用检查项 ID，新行为使用新 ID。跨轮关联以来源 Run 和反馈 ID 为准，相同检查项 ID 不继承人审。

范围按本轮真实覆盖填写。局部复验注明未重跑内容，只有覆盖该需求完整验证范围时才声明 `full`。读取反馈或修改报告文字不能作为一次新的实际验证。

## 保存与交给人审

```sh
acceptances publish --bundle <新目录> --campaign <原Campaign标题或ID>
acceptances status --run <返回的新RunID>
```

核对回执中的范围、`followUp` 和实际结果，向用户提供返回的 `webUrl`。新 Run 所有检查项均待审，用户逐项评审后系统重算状态；Agent 的处理说明不等于人工接受，不自动关闭原反馈。

来源之后被用户删除时，后续 Run 保留原始引用和处理说明，`sourceRunAvailable` 为 `false`。已有同 ID 同内容重试仍命中原 Run；不能通过编辑原包来补造新的来源。原报告及附件始终不可覆盖。
