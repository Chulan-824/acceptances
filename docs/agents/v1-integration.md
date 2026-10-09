# 现有项目与 Agent 接入 V1

适用于 local V1。Agent 在业务项目执行验证，Acceptances 保存定义、事实和证据，由所有者在 Web 决定接受或拒绝。构建是否封存、覆盖是否就绪和是否人工接受分别查询。

## 初始化服务与身份

从本仓库按 README 构建、启动、迁移并初始化所有者。在 Web 创建 Project、登记参与交付的 Repository、创建 Campaign。记录这些 UUID。给现有 Agent 创建项目 token，自动登记仓库需要 repositories:write，其余按工作需要选择 definitions:write、campaigns:write、runs:write、evidence:write、results:read、feedback:read；原始证据需要额外 evidence:read。机器 token 无人审能力。

把 token 写入仓库外 mode 600 文件，向执行 Agent 的终端提供文件路径；不把秘密写入业务仓库或提示词：

```sh
export ACCEPTANCES_URL=http://127.0.0.1:8765
export ACCEPTANCES_TOKEN_FILE="$HOME/.config/acceptances/agent-token"
```

## 给业务项目 Agent 的任务

给 Agent 本文、`contracts/schemas/` 和固定 Project/Repository/Campaign UUID，要求按以下顺序交付：

1. 在业务项目 Git 中维护 definitions 文档，固定 Case、Check Item 和 Execution Definition ID；内容变化时生成新的 versionId。字段结构以 Schema 为准。
2. 创建 Target 和 Plan。Target 固定每个参与仓库的 commit/dirty 指纹；Plan 固定 Case/Execution 版本、必测项、环境和证据要求。运行中实际构建身份放入 observedBuild，无法证明时明确 unverified。
3. 执行真实业务验证，生成一个新 Run 的报告及 `assets/` 证据。失败也按事实提交；重试执行使用 Attempt，重新验证使用新 Run，并显式声明 supersedes 前驱。报告文字或引用纠错使用同一 Run 的新 Revision，不能伪装成新测试。
4. 在 bundle 目录保存 report.json、manifest.json、documents/<documentId>.json 和 assets。原始文档 SHA-256 必须对应实际字节，Manifest 路径按 UTF-8 字节排序。参考夹具是合成失败，不能当作实际验收结果。
5. 执行离线校验和发布，保留全部 UUID；网络重试复用同一 bundle。发布只导入文档并封存事实。所有者在 Campaign 页面显式采用 Plan/Target 作为当前依据。

```sh
./build/acceptances validate /absolute/path/to/bundle --json
./build/acceptances publish /absolute/path/to/bundle --wait 120s --json
./build/acceptances status --project <project-id> --run <run-id> --revision <revision-id> --json
./build/acceptances feedback --project <project-id> --campaign <campaign-id> --json
./build/acceptances check --project <project-id> --campaign <campaign-id> --mode ready --json
./build/acceptances check --project <project-id> --campaign <campaign-id> --mode accepted --json
```

实际部署后可将已验证的新 `build/acceptances` 安装到 PATH；当前机器全局 CLI 不因修改源码自动更新。`--json` stdout 只有一个结果对象，进度在 stderr。退出码 0 成功，1 文档/门禁不满足，2 参数，3 认证/权限，4 冲突/版本，5 暂时故障或等待超时，6 内部错误。等待超时先查 status，保留原 IDs，避免创建另一个 Run。

## 人审与复验

所有者读取固定修订的实际证据后，提交 comment、reject/reject_item、resolve_rejection、accept 或逐项说明原因的 accept_risk。新失败结果不能让旧通过继续兜底；并行叶结果冲突由所有者明确选择。Plan、Target、选择或评估采用发生变化后，以当前 snapshot 重审。过期页面保留输入，刷新确认后重新提交；历史接受不等于当前接受。

拒绝后 Agent 读取 feedback，在业务仓库修复并执行新 Run。严格交付门禁使用 accepted；只有外部交付策略明确允许时才使用 `--allow-risk`。平台不会运行测试或自动修复业务项目。

## 当前交接边界

新增 Codex 接入 skill 位于 `skills/acceptances-v1`，使用 `make install-skill` 安装。只预先创建 Project，首次调用引导创建 token、仓库外配置关联；之后自动登记仓库和创建/复用 Campaign。辅助工具保留现有 Go CLI 的上传协议，命令与首次配置见 [操作参考](../../skills/acceptances-v1/references/workflow.md)。

使用新 skill 发布时，首次自动采用验收依据；当前依据发生变化时返回 ETag 并等待用户确认。上文直接使用 Go CLI 的发布仍不自动采用依据。

12–18 的代码与夹具尚待运行验收，见 [实现交接](../v1-implementation-handoff.md)。旧 acceptance-cl skill 的本地 Round、旧 Node CLI 与 V1 HTTP 协议不同，尚不能用旧流程启动或证明 V1 能力。
