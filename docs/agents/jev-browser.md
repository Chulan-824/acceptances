# 真实 Chrome + Jev 回归

当用户选择 Jev 辅助真实 Chrome 回归时，Codex 或 Claude 通过本机命令执行一个有范围和断言的任务。入口复用 `jev-ultrafast` 的页面观察与动作实现，由 Browser Harness 通过 CDP 连接本机 Chrome，直接请求 TypeSafe 官方 Jev API。它不替换 Codex、Claude 或其浏览器插件内部的模型。

本入口不启动 Playwright，不调用 `test:browser`，也不接入 OpenRouter、Vercel 或额外的文本生成模型。需要填表时，由主 Agent 在任务 `values` 中给出明确文本。

## 项目级配置

先运行 `make jev-config`。它将根目录的无凭据模板 [`.env.example`](../../.env.example) 复制为 `.env`，权限为 0600，已有文件不会覆盖。`.env` 已被 Git 忽略，`.env.example` 可随项目分发。登录自己的 [TypeSafe 官方 API Key 页面](https://console.typesafe.ai/keys)，创建 Key 后在本机编辑器中填写 `.env` 的 `TYPESAFE_API_KEY`；[官方入门说明](https://docs.typesafe.ai/introduction/quickstart)也提供该入口。不需要给桌面应用设置全局变量或重新启动 Codex。已有项目 `.env` 时，由使用者自行补充模板中的 Jev 变量。

所有 `make jev-*` 运行入口由 `launch.py` 在运行时加载该文件，再将变量注入子进程。Agent 不读取或打印 `.env*` 内容。启动器只提取模板列出的 Jev 变量，忽略其他项目变量；文件支持 `KEY=value`、可选的 `export` 前缀、成对的单/双引号和整行注释，不执行 shell、不展开变量、不支持行尾注释。配置错误只显示行号。支持的配置如下：

| 变量                 | 含义                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `TYPESAFE_API_KEY`   | 使用者自己的官方 Jev Key；执行模型任务时必需                                          |
| `TYPESAFE_MODEL`     | 官方模型，默认 `jev-1.13.0`                                                           |
| `JEV_CHROME_CDP_URL` | 可选的真实 Chrome HTTP/WS 调试地址；留空时读取宿主机 Google Chrome 标准目录发布的端点 |
| `JEV_EVIDENCE_DIR`   | 宿主机证据目录，默认 `artifacts/jev-browser`，相对路径按仓库根目录解析                |

进程环境变量优先于私有文件，包括显式的空值。可用 `JEV_CONFIG_FILE` 指向另一份专用配置；显式指定的文件不存在会停止。未创建默认文件时仍支持纯环境变量用法。Key 不进入前端变量、命令参数、镜像或日志；不要将 Key 发到聊天、任务文件或仓库。

只有项目启动器负责显式加载项目 `.env`。执行器通过进程环境读取配置。固定版本的 Browser Harness 会额外尝试加载两个 `.env` 路径，因此执行器使用专用工作目录，并在导入前检查这两个路径；如文件存在则停止，不读取内容。若环境中存在 `BU_CDP_WS`、`BU_CDP_URL` 或 `BU_BROWSER_ID`，入口停止；使用本项目的 `JEV_CHROME_CDP_URL` 配置 Chrome。

默认请求地址固定为 `https://api.typesafe.ai/v1/systemone`，模型为 `jev-1.13.0`。可通过进程环境的 `TYPESAFE_MODEL` 显式更换官方模型。每次请求会将当前页面 URL、标题、可见文本、候选控件和近期动作发送到 TypeSafe；只在获授权的页面和数据范围运行。

## 宿主机执行

启动器需要 Python 3.10+；宿主机执行 Jev 还需要 `uv`。运行 `make jev-setup` 安装锁定的 Python 3.12、虚拟环境与依赖，均位于本仓库忽略目录。依赖版本见 `tools/jev-browser/uv.lock`。

```sh
make jev-doctor
make jev-inspect URL=http://127.0.0.1:5173
make jev-run TASK=tools/jev-browser/task.example.json
```

`doctor` 只报告依赖版本与 Key 是否存在，不显示 Key、不联网，也不连接 Chrome。缺 Key 返回非零；`inspect` 不需要 Key，不调用模型。

1. 使用 `make dev-status` 确认当前服务地址。需要启动服务时遵循[工具链指南](../toolchain.md)，不要为了回归重置日常数据。
2. 使用 `make jev-inspect URL=http://127.0.0.1:5173` 连接真实 Chrome。该命令不需要 Key，不调用模型；返回的 `result.json` 包含页面文本和可操作标签。
3. 根据实际页面、用户授权和验收目标编写 JSON 任务。将任务保存在 `.scratch/<feature>/` 或系统临时目录，完整标签从观察结果复制，不猜测节点编号。
4. 使用 `make jev-run TASK=/绝对路径/task.json` 执行。读取产物与退出码，必要时通过原浏览器工具和 API 补充业务验证。仅将任务明示断言的结果报告为已验证。

未指定 CDP 地址时，只读取 macOS 或 Linux 的 Google Chrome 标准用户目录中的 `DevToolsActivePort`，不探测其他浏览器或常用调试端口。首次使用需要在 Chrome 的 `chrome://inspect/#remote-debugging` 开启远程调试，以及在原生提示中点击允许。明确配置的 HTTP 地址由 Harness 解析，WS 地址直接连接；仅接受不含凭据、查询参数和片段的地址。

入口创建一个独立后台标签，结束后只关闭这个标签。宿主机 Harness 进程会保留供后续调用复用；不同 Chrome 端点使用不同会话。遇到权限提示时完成该提示，不反复重启连接。需要保留标签排查时，可使用会加载同一项目配置的入口：

```sh
python3 tools/jev-browser/launch.py inspect http://127.0.0.1:5173 --keep-open
```

## Docker 执行器

只需要 Docker Compose 与宿主机 Python 3.10+，无需先安装宿主机虚拟环境。沿用同一私有配置：

```sh
make jev-docker-build
make jev-docker-doctor
make jev-docker-inspect URL=http://127.0.0.1:5173
make jev-docker-run TASK=tools/jev-browser/task.example.json
```

`deploy/compose.jev.yaml` 是独立的可选执行器，以 `jev` profile 和独立 Compose 项目运行，不启动现有应用或 MySQL。镜像包含 Python 与锁定的 Jev 依赖，不安装或启动浏览器。构建目录只允许工具源码与依赖锁文件，私有配置不进入构建上下文。Key 仅在容器启动时通过 `environment` 注入，缺 Key 时应用仍可正常运行，模型任务明确停止。

容器连接使用者宿主机上已经开启远程调试的真实 Chrome。macOS 的 Docker Desktop/OrbStack 使用 `host.docker.internal` 访问宿主机；启动器将 CDP 地址中的本机主机名转换为该地址，执行器在容器内将其解析为 IP，以满足 Chrome 的 Host 头校验。Linux 自动合并 `compose.jev-linux.yaml`，使用 host 网络访问 Chrome 的本机监听端口。自定义 Chrome 配置、非标准用户目录或其他主机使用显式的 `JEV_CHROME_CDP_URL`。若 Docker 环境无法访问该端点，报告连接阻塞，不创建独立浏览器作为替代。

任务的 `url` 是真实 Chrome 看到的网址，仍使用宿主机地址，例如 `http://127.0.0.1:5173` 或应用 Docker 映射到宿主机的 `http://127.0.0.1:8765`；不要改成 Compose 服务名。CDP 连接地址与待测页面地址是两个不同配置。

运行时只挂载选中的任务文件为 `/task.json`，以及证据目录为 `/evidence`；不挂载仓库、私有配置或 Chrome 用户目录。容器根文件系统只读，临时状态写入 tmpfs，以调用者 UID/GID 写回证据。一次任务结束后移除容器及连接进程，默认关闭专用标签；Docker 入口不提供 `--keep-open`。首次连接可能需要批准 Chrome 的原生提示。

直接调用 Compose 时，需要自行提供环境变量、Chrome 地址、挂载路径和 UID/GID；不要使用会展开并显示凭据的 `docker compose config` 输出作为报告。项目 Make 入口已处理这些参数，并禁用 Compose 自动加载其他 `.env` 文件。参考 [Compose 环境变量](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/)和 [uv Docker 集成](https://docs.astral.sh/uv/guides/integration/docker/)。

## 任务合同

以下示例只检查当前页面的文字；执行前用实际地址和观察到的文本替换它：

```json
{
  "url": "http://127.0.0.1:5173/",
  "goal": "检查首页，确认页面中可见“项目”文字；不要创建或修改数据。",
  "values": {},
  "allowed_write_labels": [],
  "max_steps": 20,
  "max_seconds": 120,
  "timeouts": { "navigation": 30, "login": 15, "data_ready": 30 },
  "ready": { "text": ["项目"] },
  "expect": { "text": ["项目"] }
}
```

`url` 仅支持本机 `http` 地址。每次观察均检查入口同源，离开后停止继续操作；这不构成浏览器网络隔离。`expect.url` 如提供则精确匹配完整 URL；`expect.text` 要求每段文字都出现在最终可见文本中。两类断言同时提供时全部需要通过。

仓库提供相同内容的 `tools/jev-browser/task.example.json`。确认实际页面适用后，可以运行 `make jev-run TASK=tools/jev-browser/task.example.json`；该示例只检查首页文字，不覆盖业务流程。

`values` 是观察得到的字段完整标签到文本的映射。遇到未提供值的填入动作时停止，不请求其他模型猜测。`allowed_write_labels` 用完整标签允许保存、删除、提交等动作；标签检查是启发式辅助，不能判断任意按钮的业务副作用。写操作只能使用专用合成数据，用户明确授权范围之外的日常报告不得操作。

默认最多 30 次动作尝试、120 秒；上限为 60 次、300 秒，循环次数另受动作预算两倍限制。连接 Chrome 也计入总时间预算，最终截图和标签清理各额外最多 8 秒。`timeouts` 可分别设置 `navigation`（默认 30 秒）、`login`（15 秒）、`data_ready`（30 秒），每项为 1–60 的整数；嵌套等待不会延长总时限。导航含连接、首次打开及动作发出；超时动作保留 `dispatching`，不能自动重放。

`ready` 使用与 `expect` 相同的 URL/文本结构，表示入口业务数据就绪，和最终结果断言分开。业务列表回归应填写能证明实际数据已返回的文本，例如已知行名或分页总数，不能只用页面标题。入口持续空壳或加载时，在数据时限内结束为 `data_ready_timeout`，不因文字暂时稳定而开始模型决策。未配置 `ready` 的旧任务继续兼容，只判断加载状态及指纹稳定，不能据此证明业务数据已经就绪。

发现可见密码框或 login/signin 路由时等待已有人工登录，超过时限记录 `login_timeout`；不读取密码值或猜测凭据。后续观察如重新跳回登录页则交回 `login_required`。保留登录前的单独只读探测；数据阶段每 50 毫秒在同一次快照中读取页面、登录状态和可见的 aria-busy/Ant Design 加载指示，要求语义状态连续稳定 150 毫秒。稳定判断使用上游 `marker`，同时比较滚动位置、页面高度和登录/加载状态；文字、控件身份、值、选中状态及 URL 等变化会重新计时，单纯坐标动画不会。原始 `fingerprint` 仍用于动作历史和无进展判断。持续变动仍受数据及总时限约束。这不保证未显式声明的所有异步请求结束。连续三次非等待动作没有页面变化时停止。

`click`、`fill`、`select` 在发送输入前，另用一次只读 CDP 请求按浏览器动画帧采样选中节点的位置和尺寸，要求连续 150 毫秒完全不变。单次最多等待 1 秒；节点断开、被替换、无尺寸或等待结束仍不稳定时，按 `StalePage` 处理，记录 `stale_not_executed`，沿用最多三次的动作重试及导航、总时间预算。无关控件或装饰动画不阻塞该目标。几何检查通过后，仍完整调用上游 `act`，重新检查新鲜度、节点状态、实时坐标与遮挡，再发送原有输入命令；等待期间改变的标签、禁用或只读状态仍会被拦截。`wait` 和 `scroll` 保持原路径。该检查恢复目标的稳定门槛，不保证页面在最后检查后永远不再移动。

过期动作只有明确确认输入尚未发出时才重试：重新观察同一 URL，并按动作类型、完整标签、角色与原值唯一匹配新控件，不复用旧节点编号或坐标。同一动作最多尝试三次，仍过期则以 `stale_retry_exhausted` 交回。目标被遮挡时可先滚动露出，再重新观察；滚动也单独计入动作预算。控件缺失、匹配不唯一、原值或 URL 已变化时交由模型基于新页面重新决策；执行结果不明的异常停止，不自动重放。

只将 `executed` 动作发送到模型的 `recent_actions`，未执行动作以明确状态另行反馈，避免模型把失败尝试视为已完成步骤。模型返回 `DONE` 而已有独立断言失败时，最多提供两次纠正机会；没有断言时仍为 `claimed_done`，不会当作成功。重试和纠正均受原动作与时间预算限制。

## 结果与排查

证据默认保存在忽略目录 `artifacts/jev-browser/<时间>-<进程号>/`，可通过 `JEV_EVIDENCE_DIR` 更改。Docker 中的 `/evidence` 映射回同一宿主机目录。`result.json` 记录依赖版本、上游提交、模型、每次决策耗时、动作、页面观察、断言和结果；`observations` 保留各循环的 URL、标题和可见文本，`retry_of` 指向前一次未执行尝试，成功捕获时另有质量 72 的 JPEG `final.jpg`，并核对 JPEG 文件标记。`timings` 逐次记录导航、登录和数据就绪的时限、实际秒数与完成/中断状态；`navigation_timeout`、`login_timeout`、`data_ready_timeout` 区分等待位置，`time_budget_exhausted` 表示总时限。报告可能包含页面内容和任务输入，不要提交含敏感内容的证据。

`performance` 按类别累计 `count`、`elapsed_seconds` 和 `failures`，覆盖 `setup`、`browser_init`、`snapshot`、`login_wait`、`poll_wait`、`model`、`action`、`target_geometry`、`completion_freshness`、`screenshot`、`cleanup` 及各 `cdp.<方法名>`。`target_geometry` 记录输入前的目标稳定检查，包含等待及失败。`snapshot.count` 是完整快照采样次数，`cdp.*.count` 是实际浏览器协议调用次数，包括初始化、快照、上游动作检查和清理；失败和中断也计入。统计不保存协议参数、模型请求体或凭据。阶段和 CDP 计时存在包含关系，不能直接相加；快照耗时还包含上游动作后的等待。`elapsed_seconds` 保持原有执行区间，包含浏览器初始化至最终截图和标签清理，配置与依赖准备单列为 `setup`；完整命令启动至退出的耗时需在外层另行测量。

适配器仅在单任务同步执行期间拦截固定上游模块的 CDP 调用，精确匹配原快照表达式后补充状态，结束或异常时恢复。项目 Browser 子类只在目标输入前增加几何稳定检查，模型决策、`fresh`、上游目标检查及输入命令保持原实现。当前入口不支持在同一进程并发执行多个任务。

| 结果                     | 含义                                                    | 退出码 |
| ------------------------ | ------------------------------------------------------- | ------ |
| `observed`               | 真实 Chrome 只读观察成功，未调用模型                    | 0      |
| `verified`               | Jev 返回 DONE，且任务至少一项独立断言全部通过           | 0      |
| `claimed_done`           | Jev 返回 DONE，但未提供断言或断言未通过                 | 2      |
| `blocked`                | 模型阻塞、缺少明确输入/写操作标签、预算耗尽或页面无进展 | 2      |
| `failed` / `interrupted` | 执行失败、清理失败或用户中断                            | 2      |
| `configuration_error`    | 缺 Key 或任务配置不合法，未开始执行                     | 2      |

记录中的 `executed` 表示动作已发出，`dispatching` 表示执行结果尚不确定，`stale_not_executed` 表示因页面过期未执行。遇到失败先检查记录和实际业务状态，尤其不要直接重跑可能已经提交的写操作。第三方异常仅保存类型，避免把请求凭据带入日志。

`verified` 只覆盖 URL/文字检查，不代表 API 持久化、完整 T1–T9 验收或人工接受。配置 Key 后，应先选只读路径做一次官方 API 联调，再在专用合成数据上测试写入。速度是否改善需用相同路径比较总耗时和动作次数，不能由模型名推断。

## 维护与来源

`make jev-check` 只运行 Ruff 格式/静态检查和离线行为测试，不连接浏览器、模型或业务服务。修改 Python 工具后先运行 `tools/jev-browser/.venv/bin/ruff format tools/jev-browser`。

需要复核移动控件的实际输入时，显式运行下列独立回归。脚本复用项目启动器加载配置，仅打开临时 localhost 合成页，不调用模型或访问日常报告；最终关闭自建标签及 HTTP 服务，输出 JSON 检查结果和 JPEG。覆盖持续移动的点击/填入/选择不发送输入、停止后正确点击、无关动画不阻塞，以及等待期间标签、禁用、只读、遮挡或节点替换仍拦截，并验证重试次数上限。该脚本不纳入 `make jev-check`。

```sh
PYTHONDONTWRITEBYTECODE=1 tools/jev-browser/.venv/bin/python -B tools/jev-browser/check_target_geometry.py
```

上游固定为 [`browser-use/jev-ultrafast` 提交 1231850](https://github.com/browser-use/jev-ultrafast/tree/1231850a0bf1a0c0341fe408ef1668dbbfdfac46)，复用其 `Browser`、`StalePage` 和 `choose`，项目入口补充预算、明确字段值、证据与独立断言。官方协议与模型见 [System One API](https://docs.typesafe.ai/api/system-one)、[模型文档](https://docs.typesafe.ai/models)。升级时重新核对 API、依赖的环境文件加载行为以及本机 Chrome 连接方式。
