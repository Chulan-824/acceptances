# 整包报告

一个目录保存 `report.json` 及其声明的附件。附件使用互不重复的纯文件名，不带目录、斜杠或反斜杠，必须为普通文件。CLI 自动创建 `.submission-id`，同次上传重试保留它；新的实际验证使用新的目录。总请求上限 256 MiB，超限先缩减材料，第一版整包重传。

```json
{
  "title": "登录错误提示",
  "description": "修复错误密码没有反馈的问题",
  "verifiedAt": "2026-10-09T10:00:00+08:00",
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
  ]
}
```

替换所有示例内容为真实事实，verifiedAt 使用实际验证时间。状态仅为 passed、failed、blocked、skipped。无附件用空数组；未验证的内容不得标 passed。环境或 commit 不可确定时填 `unknown`，dirty 不可确定填 null。版本信息可由 `acceptances context` 获取，报告和截图也可能包含敏感数据，上传前按业务项目规则处理。

CLI 的 `publish` 输出 Run JSON（含 id、status、reviews）；可直接用返回的 `webUrl` 打开浏览器详情。若服务返回冲突，保留原包并说明，不宣称保存成功。
