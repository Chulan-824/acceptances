# 整包报告

一个目录保存 `report.json` 及其声明的附件。附件使用互不重复的纯文件名，不带目录、斜杠或反斜杠，必须为普通文件。CLI 自动创建 `.submission-id`，同次上传重试保留它；新的实际验证使用新的目录。总请求上限 256 MiB，超限先缩减材料，第一版整包重传。

```json
{
  "title": "登录错误提示",
  "description": "修复错误密码没有反馈的问题",
  "verifiedAt": "2026-10-09T10:00:00+08:00",
  "scopeType": "partial",
  "scope": "只复验错误密码提示；未重跑其他登录场景",
  "environment": "本机 Docker，Chrome，测试数据库",
  "versions": [
    {
      "repository": "/path/to/business/.git",
      "commit": "unknown",
      "dirty": null
    }
  ],
  "checks": [
    {
      "id": "wrong-password",
      "title": "错误密码显示提示",
      "expected": "页面显示密码错误，保持未登录",
      "actual": "实际页面提示密码错误，未进入首页",
      "status": "passed",
      "evidence": ["wrong-password.png"]
    }
  ],
  "evidence": [
    { "path": "wrong-password.png", "description": "真实浏览器截图" }
  ],
  "followUp": {
    "sourceRunId": "替换为同Campaign来源Run的真实ID",
    "responses": [
      {
        "reviewId": "替换为来源Run反馈的真实ID",
        "explanation": "针对人工指出的错误密码无反馈问题修改提示逻辑，实际复验显示错误提示且保持未登录",
        "checkIds": ["wrong-password"]
      }
    ]
  }
}
```

这是报告格式示例，不是验证通过证据。替换全部示例内容为真实事实，`verifiedAt` 使用实际验证时间，Run 和反馈 ID 使用 CLI 读取到的真实值。首次验证省略 `followUp`。至少有一个检查项，状态仅为 `passed`、`failed`、`blocked`、`skipped`。无附件用空数组；未验证的内容不得标 `passed`。环境或 commit 不可确定时填 `unknown`，dirty 不可确定填 null。版本信息可由 `acceptances context` 获取，报告和截图也可能包含敏感数据，上传前按业务项目规则处理。

## 范围类型

新报告明确填写 `scopeType`，同时用 `scope` 写清覆盖及未重跑内容。以下仅展示范围字段，合并到完整报告使用：

```json
{
  "scopeType": "full",
  "scope": "覆盖本次登录提示需求的全部验证范围：错误密码提示、成功登录、连续点击防重复提交及窄屏提示展示"
}
```

```json
{
  "scopeType": "partial",
  "scope": "只复验错误密码提示和窄屏提示展示；未重跑成功登录及重复提交"
}
```

```json
{
  "scopeType": "unknown",
  "scope": "已执行错误密码场景，但尚无可靠的完整需求范围信息"
}
```

`full` 表示声明覆盖该需求完整范围，由人核对需求和证据；系统不根据范围文字推断完整性。`partial` 仅代表本轮局部验证，`unknown` 表示范围未知。旧报告缺少 `scopeType` 时仍可提交，读取时视为未知；保留原报告与原提交 ID，不补写默认字段来重传旧包。

Run 全部检查项人工通过才整轮通过；最新 Run 同时为 `full` 才使 Campaign 通过。局部或未知范围 Run 通过后 Campaign 仍待审，新 Run 不继承前轮人工状态。

## 反馈响应

`followUp` 随报告保存后不可修改。来源 Run 必须存在且属于同一 Campaign，每个 `reviewId` 必须属于该来源；同一报告中，同一反馈只填写一个响应。`explanation` 必须非空，`checkIds` 仅引用本轮检查项，不得重复，可包含多项。

无需改动、未处理或受阻时可不关联本轮检查项，写清原因，例如：

```json
{
  "reviewId": "替换为来源Run反馈的真实ID",
  "explanation": "测试环境暂不可用，尚未执行该问题的复验；本轮仅完成其他反馈对应的实际检查",
  "checkIds": []
}
```

同一反馈涉及多个行为时关联全部实际复验的检查项。新问题使用新检查项 ID，既有行为可复用 ID；关联不继承人工通过、不自动关闭原反馈。具体读取与修复流程见 [反馈处理](feedback.md)。

## 保存结果

CLI `publish` 原样上传报告；`publish`、`status` 与 `move-run` 的回执按关联的 Web 地址添加完整 Run 路由 `webUrl`，不使用 API 端口推断 Web 端口。`status` 只读查询 Run 及其当前 Campaign，按实际归属生成链接；`feedback` 保留 API JSON 字段。API 与 Web 分离时先用 `link --url <API地址> --web-url <Web地址> --project <名称或ID>` 保存地址；同源部署可省略 `--web-url`，单次命令也可用它覆盖回执地址。回执包含 `id`、`status`、`reviews`、`checkReviews`、`reviewCounts` 和 `feedbackResponses`，报告的范围与来源位于 `report`。有来源时另返回派生的 `sourceRunAvailable`，它不写入原报告。用 `webUrl` 打开详情交给人审。

`status` 是人工状态，`report.checks[].status` 是原始验证结果。用户人工接受失败项时原始失败继续保留。若服务返回冲突，保留原包并说明，不宣称保存成功。上传中断后仍用原 ID 和原内容重试；来源之后被删除不改变已保存的后续报告及其同内容重试。
