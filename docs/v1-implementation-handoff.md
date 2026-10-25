# 本地报告归档与逐项评审实施交接

> 存储更新（2026-10-25）：当前版本仅使用 MySQL。下文 SQLite 升级记录仅作历史说明，对应代码及入口已移除；当前验证命令与恢复约定以 [工具链](toolchain.md) 和 [MySQL 存储](mysql-storage.md) 为准。

本地归档基线见 `.scratch/local-simplification/spec.md` 与 [ADR-0001](adr/0001-local-report-archive.md)，逐项评审以 `.scratch/per-check-human-review/spec.md` 和 [ADR-0002](adr/0002-per-check-human-review.md) 为准，批量人工通过的批量例外见 [ADR-0003](adr/0003-bulk-human-acceptance.md)。本文件描述可执行验收步骤；实际通过、失败、阻塞和未运行结果记录在对应工单，不能把本文当通过证据。

2026-10-11 逐项评审已完成实现、隔离真实 API/浏览器验证和保留数据的日常升级，具体证据见[验证报告](../artifacts/per-check-human-review/verification/REPORT.md)。日常旧报告的检查项仍待用户逐项评审。

2026-10-22，日常存储切换为 MySQL，旧 SQLite 保留数据导入及验证入口见 [MySQL 存储](mysql-storage.md)。下方早期 SQLite 升级步骤作为历史交接保留，当前部署以该文档为准。

## 静态与集成检查

```sh
pnpm install --frozen-lockfile --ignore-scripts
make lint typecheck build
make test
make test SUITE=agent
make test SUITE=platform
```

Go HTTP 集成测试覆盖隔离 SQLite 与附件目录中的失败边界。原生进程检查自动初始化、readiness、静态 Web 和正常停机。两者均不证明真实 Docker 或浏览器通过。

## Docker 与真实浏览器

用独立 Compose 项目名启动测试容器与卷，不复用日常数据。默认端口 8765，测试前确认空闲；需要并行时显式提供 Compose override 并同步服务公开地址。归档镜像摘要、Compose 配置、端口绑定、运行 UID 和 readiness。

按规格验证：

- T1：干净卷一条命令启动，无账号/token；保存报告、附件和反馈后重启，内容仍可读。
- T2：Web 创建 Project，skill 关联两个临时仓库；同仓库 worktree 复用关联。
- T3：分别显示原始通过、失败、阻塞、跳过和人工状态；显示完整、局部、未知范围以及未知环境/版本，核对图片、录像、日志。
- T4：完整范围 Run 全部逐项人工通过后 Campaign 通过；新建 Run 后各项及 Campaign 待审，历史判断保留。CLI 可读取逐项判断、理由及反馈响应。
- T5：评论不改原报告和当前人工状态；作废原因可见，作废后只能评论，不能通过、不通过或撤回。
- T6：分别确认并删除 Run、Campaign、Project，清理所属附件和反馈；另一 Project 和业务目录保持完整。
- T7：上传中断、缺少附件、非法报告和保存失败不暴露半成品；响应丢失后重试不重复，同 ID 不同内容冲突。
- T8：拒绝越界路径，文本安全展示，上传内容不能作为同源可执行页面运行。
- T9：核对当前容器和卷，备份后在原卷增量升级逐项评审；安装后的 CLI 和 skill 无需凭据或源码目录，新报告范围与反馈关联实际往返可读。

## 逐项评审验收矩阵

在独立 SQLite 与证据目录构造两项以上的 Run，使用真实 API 和浏览器分别验证：

| 行为                             | 必须观察到的结果                                                              |
| -------------------------------- | ----------------------------------------------------------------------------- |
| 部分项通过，其余待审             | Run 待审，计数与各项当前状态一致                                              |
| 一项不通过，其余待审             | Run 和最新 Campaign 立即不通过                                                |
| 全部逐项人工通过                 | Run 自动通过，无额外整轮确认；最新完整 Run 才使 Campaign 通过                 |
| 失败、阻塞、跳过项人工通过       | 空理由被拒绝，有理由可通过，原始结果保持不变                                  |
| 不通过、评论、普通通过、撤回     | 不通过与评论必须非空，普通通过和撤回理由可选                                  |
| 已通过项新增评论                 | 评论追加到历史，当前人工状态不变                                              |
| 改判及撤回                       | 历史保留、当前状态和整轮计数立即重算；相同时间戳下按保存顺序取判断            |
| 逐项接口不带检查项的改判、未知项 | API 拒绝；批量确认使用独立的批量人工通过接口                                  |
| 作废 Run                         | 原结果、历史及原因保留，判断与撤回被拒绝，评论可保存                          |
| 最新局部或范围未知 Run 全部通过  | Run 通过，Campaign 仍待审                                                     |
| 历史 Run 改判、新 Run 创建       | 旧轮改判不影响最新 Campaign，新轮全部待审                                     |
| 有效反馈复验关联                 | 同 Campaign 来源 Run 和反馈可读，原反馈能导航到新 Run 与本次检查项            |
| 非法关联                         | 跨 Campaign、错误来源反馈、本轮不存在或重复检查项、重复反馈、空处理说明被拒绝 |
| 未处理或受阻的反馈               | 空 `checkIds` 可保存，说明讲明原因，不把响应当人工通过                        |
| 来源 Run 删除                    | 后续原报告与说明不变，来源标为已删除；已保存提交同 ID 同内容仍可重试          |

完整、局部和未知范围各保存一轮，核对 `publish`、`status`、`feedback` 的 `report.scopeType`、`report.followUp`、`checkReviews`、`reviewCounts`、`feedbackResponses`。原始验证失败但人工通过时保留两种结果。新 Run 不继承旧判断，反馈响应不自动关闭原反馈。

浏览器记录理由提示、待审/通过/不通过数量、逐项历史、评论与改判、来源响应导航及窄屏下的可用性。真实 API 单独检查门禁和响应数据；只点击页面不能证明非法请求会被拒绝。

## 批量人工通过验收矩阵

使用专用服务与数据目录验证，不替日常报告作人工判断。

| 行为                             | 必须观察到的结果                                                         |
| -------------------------------- | ------------------------------------------------------------------------ |
| 全待审、部分已通过、包含人工拒绝 | 弹窗列出总数和当前判断；确认后全通过，原历史保留，已通过项不新增判断     |
| 原始失败、阻塞、未执行项         | 弹窗显示异常结果；批量无需理由可通过，原始结果不变；逐项门禁仍有效       |
| 搜索或筛选、取消                 | 汇总覆盖整份报告；取消不发送交付请求，不改变判断                         |
| 重复或并发提交                   | 均成功返回同一 Run，没有重复逐项记录                                     |
| 中途保存失败                     | 所有新判断及 Run、Campaign 状态回滚；弹窗显示错误并可重试                |
| 完整、局部、未知、历史 Run       | Run 全通过；仅最新完整 Run 使 Campaign 通过                              |
| 交付后改判、撤回、新 Run         | 旧历史保留，状态立即重算；新 Run 各项重新待审                            |
| 作废及布局                       | 作废禁止交付；固定栏与汇总弹窗在桌面、窄屏可操作，提交期间其他评审被禁用 |

## 浏览器回执入口

浏览器回执入口为 `make test SUITE=e2e`。设置 `ACCEPTANCES_E2E_RUNNER` 为真实浏览器驱动绝对路径、`ACCEPTANCES_E2E_URL` 为专用本机服务地址，设置 `ACCEPTANCES_TEST_ISOLATED=1`。驱动接收 `--base-url <origin> --receipt <absolute-json-path>`，回执含 `steps` 数组，每项包含 `name`、`outcome: passed` 和 `evidence` 文件路径数组。

必需步骤名为 `project-create`、`report-evidence`、`review-new-run`、`comment-void`、`cascade-delete`、`unsafe-evidence`。证据放在 `artifacts` 内。入口只检查回执完整性与源码未变化，必须同时保留真实驱动代码/版本、截图和断言记录。现有回执步骤名不自动证明逐项评审矩阵已覆盖，驱动需另外记录这些行为的操作和断言。T1–T9 中的 CLI、重启和故障注入仍需独立核对。

## 当前运行库的保留数据升级

本次迁移对象是当前本地版 `archive.db`，不是从更早的历史架构导入数据。保留 Project、Campaign、Run、原报告、证据及旧整轮评审。旧接受、拒绝标记为历史决定，各项从待审开始并重算状态；作废 Run 保持作废，缺少范围的旧报告按未知读取。迁移保存版本并在事务内完成，第二次启动不能再次清空新增判断。

先在隔离旧库验证迁移、重启和数据完整性，再升级日常运行库。核对实际容器 ID、Compose 标签及挂载卷，停止应用写入后备份完整数据目录；以下命令使用仓库默认部署：

```sh
ACCEPTANCES_UPGRADE_CONTAINER=$(docker compose -p acceptances -f deploy/compose.yaml ps -q app)
docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}} {{json .Mounts}}' "$ACCEPTANCES_UPGRADE_CONTAINER"
```

确认标签为本项目的 `acceptances` / `app`，挂载目标为 `/var/lib/acceptances`。自定义 Compose 项目需要同步命令参数，不能凭容器名推断卷。目标核对完成后：

```sh
mkdir -p artifacts/backups
ACCEPTANCES_UPGRADE_BACKUP=$(mktemp -d "$PWD/artifacts/backups/per-check-upgrade.XXXXXX")
docker compose -p acceptances -f deploy/compose.yaml stop app
docker cp "${ACCEPTANCES_UPGRADE_CONTAINER}:/var/lib/acceptances/." "$ACCEPTANCES_UPGRADE_BACKUP/"
```

备份包括 `archive.db`、可能存在的 SQLite WAL/SHM 文件和 `evidence`。确认复制成功，记录备份路径、旧镜像摘要和数据库/附件摘要；复制失败先解决备份问题，不开始迁移。保留备份并在隔离目录核对可读取性，再执行：

```sh
docker compose -p acceptances -f deploy/compose.yaml up --build -d
curl --fail http://127.0.0.1:8765/health/ready
```

核对升级前后的项目、需求、Run、旧评审数量及原报告和附件摘要。确认旧整轮判断只显示为历史，各项待审，作废不变。逐项判断的重启保留使用隔离夹具验证；日常库只读核对，不替用户提交人工判断。实际运行库结果单独记录，隔离迁移成功不能替代日常运行库升级结果。

本次无需删除或重建数据卷，不执行 `down -v` 或全局清理。持久卷仍不挂载业务仓库。CLI 与 skill 使用 `make replace-skill` 显式重新安装，仅修改源码不能证明宿主机已升级；安装测试使用临时目标，不覆盖日常安装。

## 许可

仓库许可、来源和公开分发限制继续由根 LICENSE、LICENSE-SCOPE 和 NOTICE 管理；此次本机架构重构不改变授权范围。
