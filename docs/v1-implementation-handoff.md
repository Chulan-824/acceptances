# 本地精简版实施交接

规格以 `.scratch/local-simplification/spec.md` 为准，领域决策见 [ADR-0001](adr/0001-local-report-archive.md)。本文件描述可执行验收步骤；实际通过、失败和未运行结果记录在对应工单，不能把本文当通过证据。

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
- T3：检查通过、失败、局部验证、未知环境/版本及图片、录像、日志展示。
- T4：接受后新建 Run，Campaign 待审，历史决定保留；CLI 可读拒绝与反馈。
- T5：补充说明保留原报告；作废原因可见，作废后不能接受。
- T6：分别确认并删除 Run、Campaign、Project，清理所属附件和反馈；另一 Project 和业务目录保持完整。
- T7：上传中断、缺少附件、非法报告和保存失败不暴露半成品；响应丢失后重试不重复，同 ID 不同内容冲突。
- T8：拒绝越界路径，文本安全展示，上传内容不能作为同源可执行页面运行。
- T9：核对旧项目容器/卷，替换为新版；安装后的 CLI 和 skill 不要求旧凭据、协议或源码目录。

浏览器回执入口为 `make test SUITE=e2e`。设置 `ACCEPTANCES_E2E_RUNNER` 为真实浏览器驱动绝对路径、`ACCEPTANCES_E2E_URL` 为专用本机服务地址，设置 `ACCEPTANCES_TEST_ISOLATED=1`。驱动接收 `--base-url <origin> --receipt <absolute-json-path>`，回执含 `steps` 数组，每项包含 `name`、`outcome: passed` 和 `evidence` 文件路径数组。

必需步骤名为 `project-create`、`report-evidence`、`review-new-run`、`comment-void`、`cascade-delete`、`unsafe-evidence`。证据放在 `artifacts` 内。入口只检查回执完整性与源码未变化，必须同时保留真实驱动代码/版本、截图和断言记录。T1–T9 中的 CLI、重启和故障注入仍需独立核对。

## 数据替换与许可

旧数据不迁移。清理前核对实际容器的 Compose 标签和挂载卷，只删除确认属于旧 Acceptances 的资源，不使用全局 prune。新版持久卷不挂载业务仓库。CLI 与 skill 必须显式重新安装，仅修改源码不能证明宿主机已经升级。

仓库许可、来源和公开分发限制继续由根 LICENSE、LICENSE-SCOPE 和 NOTICE 管理；此次本机架构重构不改变授权范围。
