# 正式交付与业务说明材料

用户要求正式冻结交付或生成业务说明时，在实际验证报告发布前准备本文材料。普通验证仍可如实归档失败、局部、未知版本；正式冻结要求更严格。归档成功、本轮人工接受和正式冻结分别表达。

多轮验证后需要对整体需求重新回归时，先按[需求交付前全量回归](pre-delivery-regression.md)盘点当前需求及全部历史 Run，再将本文材料随本次实际验证准备。

## 准备顺序与完成条件

1. 用 context 和 campaigns 回执取得实际 Project/Campaign 及每个 Repository 的受验版本。正式交付的源码必须已提交、完整 commit 明确、dirty=false。先提交再验证，不把含改动的旧验证事后改成干净版本。
2. 从用户需求及项目知识准备版本明确的需求原文与地图。地图列出交付范围内的功能、稳定检查项、预期和必验标记；排除范围写明。功能/check ID 在 Project 内长期唯一、稳定，改名不换 ID，检查预期实质变化新建 check ID。
3. 根据实际验证编写 report.json，每个地图必验 check 都在这一个 Run 内出现，id 和 expected 一致。原始失败、阻塞、未执行如实记录，不跨历史 Run 拼接通过。
4. 编写业务说明素材，功能说明、角色、前提、步骤、限制和截图对应地图及本轮实际检查。截图是该检查项真实 evidence，上传前完成业务项目要求的脱敏。
5. 保存真实运行构建的标识、产物、SHA-256 和源码绑定；无需构建的项目明确记不适用并说明原因。静态候选源码包、源码 commit 或地图 zip 不能冒充运行构建证据。
6. 材料定稿后计算附件 SHA-256，形成固定名称 delivery-manifest.json。全部附件平铺，逐个声明在 report.evidence 中，与实物一一对应。执行 `acceptances validate --bundle <目录> --formal --project <实际ID> --campaign <实际ID>`，通过后使用 `acceptances publish --bundle <目录> --campaign <实际ID> --formal` 发布真实 Run。两者复用冻结材料校验；离线预检不创建 Run 或 submission ID，不代表人工接受。
7. 用户逐项评审或一键接受后，在 Web 从需求顶部点击“确认需求交付”。用户确认地图版本/范围、说明内容与敏感信息检查，并为原始未通过项确认具体接受理由。Agent 提供材料和事实，不代替人执行冻结、接受或撤销。

已完成验证只缺版本记录或交付材料时，可为原 Run 追加资料，不要求重复验证或新建 Run。项目侧先确认补充材料属于同一次验证，运行 `acceptances preparation --run <ID>` 获取当前 token，在补充目录准备 `supplement.json` 和新附件，再运行 `acceptances supplement --run <ID> --bundle <目录>`。原结果、验证时间、原附件和人审保持不变，补充历史单独记录。源码或实际受验版本确实变化时才重新判断验证范围，不能用补录冒充对新版本的验证。

supplement.json 示例结构：`{"requestId":"本次稳定唯一标识","token":"准备回执token","reason":"补充依据及版本对应关系","verificationUnchanged":true,"versions":[{"repository":"实际来源","commit":"完整提交摘要","dirty":false}],"evidence":[{"path":"delivery-manifest.json","description":"正式交付清单"}],"checkEvidence":{}}`。实际还须逐一声明和上传清单引用的新文件；checkEvidence 可将后补真实证据关联原检查项。同名附件不能覆盖，重名时改用新文件名并重算引用摘要。已有附件可直接引用，不重复上传；新增图片使用 JPEG。固定 manifest 尚不存在时再补入，已经冻结的 Run 不再接受补充。

提交成功后使用 `status` 和 `preparation` 确认原 Run ID、结果与人工计数不变，材料摘要通过并查看 Web 补充历史。重试保留原 supplement.json、token、requestId 和附件，陈旧 token 先回读确认是否已成功，不换标识掩盖冲突。补充不自动冻结；原始未 passed 项的具体接受理由仍由人在最终冻结时确认。

## 三份 JSON 的契约

均采用 schemaVersion=1，未知字段拒绝。文件名除固定 manifest 外可自定，必须是单层纯文件名。manifest 及每份结构化地图/素材不超过 1 MiB；需求原文非空且不超过 1 MiB，总 Run 上传仍为 256 MiB。

以下是格式示例，所有 ID、提交、摘要、结果和附件须替换为本次真实数据；示例不是验证证据，也不能原样标为 passed。

delivery-manifest.json：

```json
{
  "schemaVersion": 1,
  "projectId": "实际 Project ID",
  "campaignId": "实际 Campaign ID",
  "requirement": {
    "path": "requirement.md",
    "sha256": "需求原文字节的64位小写SHA256"
  },
  "map": {
    "path": "feature-map.json",
    "sha256": "地图文件字节的64位小写SHA256"
  },
  "materials": {
    "path": "business-materials.json",
    "sha256": "说明素材文件字节的64位小写SHA256"
  },
  "build": {
    "kind": "artifact",
    "id": "实际运行构建的明确标识",
    "artifact": {
      "path": "build-artifact.zip",
      "sha256": "真实构建产物字节的64位小写SHA256"
    },
    "sources": [
      {
        "repository": "与report.versions完全相同的代码来源",
        "commit": "真实完整40或64位小写提交摘要",
        "dirty": false
      }
    ],
    "reason": ""
  }
}
```

sources 逐一对应 report.versions，不可漏掉、多出或重复代码来源。artifact 文件必须独立于需求、地图和说明素材。无需构建时使用下列 build，并继续记录 sources：

```json
{
  "kind": "not-applicable",
  "id": "",
  "artifact": { "path": "", "sha256": "" },
  "sources": [
    {
      "repository": "与受验报告相同的来源",
      "commit": "实际完整提交摘要",
      "dirty": false
    }
  ],
  "reason": "说明为什么本次产品不存在独立构建，例如受验对象为直接运行的源码脚本"
}
```

feature-map.json：

```json
{
  "schemaVersion": 1,
  "projectId": "实际 Project ID",
  "requirementSha256": "与manifest.requirement.sha256相同",
  "excluded": ["明确本次需求范围之外的行为；无排除则使用空数组"],
  "features": [
    {
      "id": "vtt-export",
      "title": "字幕导出",
      "checks": [
        {
          "id": "vtt-export--download",
          "title": "下载字幕文件",
          "expected": "与本轮report对应检查项的expected一致",
          "required": true
        }
      ]
    }
  ]
}
```

feature ID 使用小写字母、数字、点、下划线和连字符；check ID 同时接受大写 ASCII 字母，以保留既有 Run 的稳定标识。两者首字符为字母或数字，最长 200 字符，大小写敏感，不自动改名。每份地图的 feature ID 和 check ID 分别唯一；每个纳入交付的功能至少一个必验项。一项 check 在地图中归属一个功能。候选地图的模块、场景和检查变体须由项目侧明确映射，不把场景数直接当作实际 Run 检查数。

business-materials.json：

```json
{
  "schemaVersion": 1,
  "projectId": "实际 Project ID",
  "requirementSha256": "与manifest.requirement.sha256相同",
  "mapSha256": "与manifest.map.sha256相同",
  "features": [
    {
      "featureId": "vtt-export",
      "summary": "向使用者说明功能及入口。",
      "roles": ["具有导出权限的用户"],
      "prerequisites": ["已打开包含字幕的工作页"],
      "steps": [
        {
          "instruction": "点击导出按钮。",
          "expected": "浏览器提供字幕文件下载。",
          "checkIds": ["vtt-export--download"]
        }
      ],
      "limitations": [],
      "screenshots": [
        {
          "path": "export-screen.jpg",
          "caption": "说明截图展示的真实操作与结果。",
          "checkIds": ["vtt-export--download"]
        }
      ],
      "screenshotOmissionReason": ""
    }
  ]
}
```

每个地图功能都有且只有一份说明。角色及步骤非空，前提和限制没有额外内容时使用空数组。步骤和截图的 checkIds 只关联该功能在最终 Run 中实际存在的检查项；每张截图也必须出现在这些检查项的 evidence 中。含原始非 passed 项的功能必须写明相关业务限制，不写成已验证通过。

新增截图统一使用真实 JPEG（.jpg 或 .jpeg），采集时直接编码，不能只改后缀。预检检查全部声明图片的实际格式、完整解码和尺寸；普通发布也执行 JPEG 检查，材料清单存在时自动执行完整交付材料检查。历史 Run 的 PNG/GIF 继续可读，不转码或改写。单张不超过 10 MiB、4000 万像素，说明中引用的图片合计不超过 32 MiB。无对应图时使用明确的 screenshotOmissionReason，例如非图形操作或实际未执行，保持事实，不编造图。HTML、SVG、外部 URL 及脚本不作为截图或渲染模板。

SHA-256 基于最终文件的原始字节。先定稿需求，填地图的 requirementSha256；定稿地图后填素材的 mapSha256；最后填 manifest 全部引用。更改文字、空格或附件内容后重新计算摘要。服务不会读取业务工作目录补全材料。

## 冻结后与说明版本

交付快照保存原报告、人审、例外理由、范围确认及附件副本。人审改判/撤回、作废或删除来源会使交付失效，原内容与效力事件分别保留；重新接受不会自动恢复，需再次明确冻结。新 Run 不继承旧判断，新的冻结才替代当前有效版本。

用户在有效交付详情点击“生成业务说明”，平台以冻结材料确定性生成带内嵌图片的离线 HTML，无服务端 LLM。失败重试保留同一说明版本；明确重新生成创建新版本。业务说明不写回 Run/快照，也不为挂文档创建验证记录。

失效或被替代后停止新生成，旧说明仍可作为历史预览和下载。已下载文件不会自动随改判变化，当前效力以平台为准。Project/Campaign/Run 删除后，交付档案和独立文档继续保留。没有公开托管或自动对外发送。
