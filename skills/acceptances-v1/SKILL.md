---
name: acceptances-v1
description: 在业务项目中调用 Acceptances V1，对指定需求自动生成验收资料、执行验证并发布真实证据，交给用户人工验收。处理首次项目关联、同一需求复验和发布重试。
---

# Acceptances 需求验证交付

用户说“调用 Acceptances，对 XX 需求完成自动化验证”时，在当前业务仓库执行本流程。交付是封存报告、真实证据和 Web 人工验收入口。测试失败也交付事实；不以成功上传代替验收通过。不使用旧 acceptance-cl、本地 Round 或 Node CLI。

本技能的确定性工具是 `scripts/acceptances.mjs`，后文称 runner。使用实际 SKILL.md 所在目录求出 runner 绝对路径。要求 Node >=22；V1 Go CLI 和契约来自首次关联的 Acceptances 源码目录。安装目录的 `installation.json` 记录源码目录和 `nodeExecutable`；调用 runner 时优先使用记录的 Node 绝对路径，避免 shell 默认 Node 过旧。首次接入、参数和文件结构见 [接入及交付操作](references/workflow.md)。

## 关联需求与项目

1. 读取业务项目适用规则及实际存在的需求文档、工单、测试/启动说明。若有 `.agents/acceptance/PROJECT.md`，再读取其中引用的环境说明。验收依据必须是明确指定的需求或当前聊天中已确认的需求。代码用于核对实现，不反推需求。将推导的测试边界注明来源；影响通过条件的歧义集中询问，其余检查继续。
2. 运行 `inspect --repo <业务仓库>`。未关联时，询问用户已创建的 Project UUID，引导其在 Web 创建项目 token，通过 `scripts/save-token.py` 在用户自己的终端隐藏输入并保存仓库外文件，再执行 `connect`。不把 token 粘贴进聊天，不读取/输出其内容。关联配置按 Git common directory 隔离，worktree 共用关联；每次运行分别记录源码指纹。
3. 需求标识优先使用完整工单 URL/ID，或仓库内规范化的需求文档相对路径。仅有聊天需求时，先提出稳定标识供用户确认一次，并将确认的需求正文保存为可维护的验收定义来源。相同标识复用活动；名称相似不构成复用依据。不要为重复发布生成新需求标识。
4. 调用 `prepare --key <需求标识> --title <标题>`，自动登记仓库并创建/复用 Campaign。返回有歧义时请用户选择；只有得到具体活动 ID 后才使用 `--campaign`。取得既有活动的反馈，不把旧拒绝静默消除。

## 准备并执行真实验证

- 优先复用业务仓库已有验收定义及测试。新增定义放业务仓库的既有目录；无既有目录时使用 `acceptance/definitions/<需求标识的安全目录>/`。用户未授权提交时不 add、commit 或 push。不改变旧 `.acceptances` 数据。
- 按关联配置的 `contracts/schemas/` 生成 definitions、Plan、Target 和报告。Case、Check Item、Execution、Plan Item 保留稳定 ID；语义变化生成新 versionId 和不可变文档 ID。definitions 与 Plan 记录需求来源，Plan 明确业务结果、必测项、环境、证据要求。
- 新的实际复验运行 `new-run --key <标识>` 创建新的 Run/Revision 和仓库外产物目录。网络重试复用已有 bundle；单纯报告纠错使用同一 Run 的新 Revision 和 replacesRevisionId，不运行 new-run 冒充复验。既有报告事实不可修改。
- 在开始验证前调用 `snapshot --scope <JSON 文件>`，复用 Go 协议的 dirty 指纹采集。范围覆盖构建实际输入；排除、秘密、子模块或未知输入导致不完整时如实记录。不得读取业务项目 `.env*` 内容。执行结束再次采集；发生变化时报告变化并按需求重验，不宣称原 Target 已验证。运行构建身份不能用工作区 HEAD 推断；无实际证据时 observedBuild=unverified。
- 复用用户已运行的服务。环境未启动时按项目文档启动明确的本地开发服务，仅停止本次自己启动的进程。测试环境部署另行授权。缺账号或配置时请求用户完成登录或安全配置；不猜测秘密。
- 可在明确指定的本地/测试环境创建专用测试数据。删除已有数据、付费任务、对外发消息需要单独授权。未获授权或缺环境的项目记录未运行及原因，不伪造失败或通过。
- 执行实际测试、接口及浏览器操作，证据来自本次运行。静态检查、合成夹具与真实业务验证分别记录。验证指令不授权修复业务代码；失败则交付报告与反馈。重复执行使用 Attempt；修复后实际复验创建新 Run，并在对应结果中显式 supersedes 前驱。

## 发布并交给人审

1. 在 bundle 写报告、文档原文及真实资产描述，执行 `pack`，工具计算摘要、大小和 JCS，并调用现有 Go CLI validate。生成的 manifest 存在后视为固定 bundle；重试只校验，不重新编码。变更原文需要新文档或 Revision 身份。
2. 执行 `deliver --key <标识> --bundle <目录>`。工具复用 Go CLI publish。超时/结果未知时保留 bundle 和 UUID，使用 Go CLI status 确认持久状态再重试；不要创建新 Run。
3. 首次自动采用验收依据；依据相同沿用。返回 `confirmation_required` 时展示当前及拟采用 Plan/Target，询问是否切换。只有明确确认后，重跑 deliver 并传返回的 `--confirmed-basis <ETag>` 与 `--reason <原因>`。并发改变后旧 ETag 失效，重新确认，不覆盖他人的操作。
4. 最终返回需求、代码身份、Run/Revision、通过/失败/未运行项、发布状态、依据状态、ready 与 accepted 状态及可点击 Web URL。待切换依据时说明门禁基于旧依据。原始证据缺失或 observedBuild 未核实可能无法 ready，不降低门禁。
5. 人工拒绝后，读取 feedback；用户授权修复并完成新验证时续用活动并发布新 Run。人工接受、拒绝及解决拒绝事件由用户在 Web 完成。不得使用用户密码/会话替人审，也不自动使用 allow-risk。
