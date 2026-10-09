# 首次接入和工具命令

从 SKILL.md 的位置求出 `scripts/acceptances.mjs` 绝对路径。安装目录的 `installation.json.nodeExecutable` 是已验证的 Node 路径，优先用它替代下文的 `node`。所有命令输出单个 JSON，对本地错误或 API 错误返回非零；不能将非零当作成功。Node >=22，仅使用标准库。

## 首次接入

用户只预先在 Web 创建 Project。读取安装目录的 `installation.json` 获取 Acceptances 源码目录；源目录中的 `build/acceptances` 必须是本机平台的当前 V1 CLI，Docker 内的 Linux CLI 不能直接在 macOS 使用。若缺失或不支持 fingerprint，在 Acceptances 仓库按 README 配置工具链并运行 `make build`。

```sh
node <runner> inspect --repo <业务仓库>
```

首次询问 Project UUID，打开 `http://127.0.0.1:8765/projects/<UUID>`。引导用户创建 token，勾选 repositories:write、definitions:write、campaigns:write、runs:write、evidence:write、results:read、feedback:read；需要下载原始证据才加 evidence:read。默认 90 天。旧 token 不会自动获得新权限，应重新创建。

用户在自己的交互终端运行下面命令，粘贴 Web token；输入不回显、不写 shell history，脚本不输出秘密：

```sh
python3 <skill-dir>/scripts/save-token.py "$HOME/.config/acceptances/tokens/<项目标识>"
```

仅把绝对文件路径交给 agent。然后执行：

```sh
node <runner> connect --repo <业务仓库> \
  --project <UUID> --token-file <绝对文件路径> \
  --acceptances-root <源码目录>
```

关联配置在 `~/.config/acceptances/projects/<Git common dir SHA256>.json`，运行产物在 `~/.local/share/acceptances/runs/<同一键>/`。权限分别 600/700。token 无效时在 Web 更新 token 文件，再重新 connect；不同项目/服务重新关联须人工明确迁移配置，脚本不会静默替换。`--config-dir`、`--data-dir` 用于自定义仓库外目录或隔离测试。

服务没启动时在 Acceptances 仓库使用 `make docker-up`。代码更新后需要 `make docker-rebuild`；新权限不会出现在旧镜像中。不删除卷、不重新初始化已有所有者。

## 需求和活动

```sh
node <runner> prepare --repo <业务仓库> \
  --key <稳定工单标识或文档相对路径> --title <交付标题>
node <runner> feedback --repo <业务仓库> --key <标识>
node <runner> new-run --repo <业务仓库> --key <标识>
```

默认仓库 locator 为 Git 主工作区的本机路径；worktree 复用同一身份。首次可通过 `prepare --locator <无凭据的 Git URL>` 明确设置。不会自动读取可能含凭据的 remote URL。同一地址登记多次且无已关联 ID 时，工具返回候选列表；用户确认后可用 `prepare --repository <UUID> --locator <对应地址>` 选定。

Repository 和 Campaign 的创建 ID 由项目与稳定标识确定；响应丢失后重试相同命令不会创建新的活动。服务端按 externalRefs 的 `acceptances/requirement` 匹配；多个匹配返回歧义。需要确认后接入已有活动时使用 `--campaign <UUID>`，不要按相似标题猜测。

new-run 只分配运行身份和空证据目录，不执行测试，不生成通过结果。返回 run.json、bundle、上次封存的 Run/Revision/result ID，供显式声明 supersedes。目录已有时用于重试，不再运行 new-run。

## 源码快照

在开始和结束验证时采集，scope JSON 的结构是：

```json
{
  "include": ["src/**", "package.json", "pnpm-lock.yaml"],
  "exclude": [],
  "missingInputs": []
}
```

按项目实际构建输入扩大范围，不直接照抄示例。

```sh
node <runner> snapshot --repo <业务仓库> --scope <scope.json绝对路径>
```

返回 `manifest`、`fingerprint`、`scopeDigest`。使用协议原始 collector，涵盖未跟踪文件和删除项，拒绝读取识别的秘密文件；遇到秘密或排除项会标记 incomplete。作为 Target dirty revision 和 report.sourceSnapshots 的材料，字段映射以 common.json Schema 为准。干净的完整提交可使用 commit Target；源码快照不证明浏览器运行的是该构建。

## 报告和证据打包

字段以配置中 contractsDir 的 `schemas/` 为准。`contracts/fixtures/failed-bundle` 只用于了解结构，不复制合成结果冒充验证。pack 需要全部文档原文。

```text
<bundle>/
  run.json
  report.json
  documents/<definitions-id>.json
  documents/<plan-id>.json
  documents/<target-id>.json
  assets/<本次实际证据>
```

agent 生成 definitions 和报告的业务内容；pack 只补原文字节摘要，不推断测试结果或修改 outcome。Plan 中 caseRef/executionRef 的 documentId 必须指向对应 definitions。report 的 planRef/targetRef.id 必须正确；sha256 可先填 64 个零，pack 根据原文更新。pack 可能格式化新 Plan 和 report，因此应在首次发布前运行；已生成 manifest 后再次 pack 只 validate，报告纠错必须新建 Revision bundle。

资产描述 JSON 位于 bundle 外或其旁边，输入示例：

```json
[
  {
    "id": "<实际UUID>",
    "path": "assets/save-response.txt",
    "kind": "text",
    "mediaType": "text/plain"
  }
]
```

不要求把额外 run.json 或资产描述上传，manifest 仅声明正式文档和证据。

```sh
node <runner> pack --repo <业务仓库> --bundle <目录> --assets <描述JSON>
node <runner> deliver --repo <业务仓库> --key <标识> --bundle <目录>
```

等待超时先按 run.json 中的 ID 查询：

```sh
ACCEPTANCES_URL=<本机地址> ACCEPTANCES_TOKEN_FILE=<文件> \
  <配置中的CLI> status --project <UUID> --run <UUID> --revision <UUID> --json
```

deliver 只有在报告属于关联项目及活动、validate 成功后才 publish。成功封存后保存该需求的最新 Run，首次采用依据，相同依据沿用。

`basis.status=confirmation_required` 时，请用户确认具体新旧依据；确认后原 bundle 重试：

```sh
node <runner> deliver --repo <业务仓库> --key <标识> --bundle <目录> \
  --confirmed-basis '<返回的ETag，含双引号>' --reason <用户确认的原因>
```

该参数代表用户对那个版本的具体确认；ETag 变化时停止切换，不能自动刷新并再次尝试。发布幂等，不会重复执行测试。

输出包含 publication、basis、ready、accepted、reviewUrl。accepted 的查询始终 allowRisk=false。若 basis 待确认，ready/accepted 可能描述旧计划；必须明确标注。拒绝后的修复需要用户授权，复验以新 Run/result.supersedes 延续，不创建新的 Campaign 来绕过拒绝。
