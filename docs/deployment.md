# 服务器部署与成员安装手册

更新日期：2026-10-26。按当前仓库的 Makefile、Compose、CLI 和安装器编写。本文提供操作步骤，本次文档整理未执行服务器部署、证书配置或跨电脑验收。

适用于一台 Linux 服务器部署 Acceptances，成员通过 HTTPS 使用 Web，在各自电脑执行验证和上传报告。当前方案是单实例应用加 MySQL，Go 服务同时提供 API 与已构建的 Web；无需额外启动 Vite。

## 1. 先确定哪些工具装在哪里

| 使用位置与用途                    | 必需工具                                                                                            | 可选工具                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 部署服务器                        | Git、make、Node.js `26.7.0`、Docker Engine、Docker Compose、curl；团队入口还需 HTTPS 网关或反向代理 | 本文用宿主机 Nginx 举例                             |
| 只查看报告、人工评审的成员电脑    | 浏览器和平台账号                                                                                    | 无需 CLI、Skill、Go 或 Docker                       |
| 执行验证、上传报告的成员电脑      | 可执行任务的 Agent、`acceptances` CLI、`Acceptances-Cl` Skill、业务项目本身的运行与验证依赖         | 按验证内容配置真实浏览器工具                        |
| 从源码安装 CLI / Skill 的成员电脑 | Git、Python 3、make、Go `1.26.8`                                                                    | 无需先安装本项目的 Node/pnpm 依赖                   |
| 从飞书导入 PRD 的成员电脑         | `acceptances` CLI、Lark CLI `1.0.98`、个人飞书授权                                                  | 仅用连接器时不要求安装 Agent 或 Skill               |
| 选择 Jev 的验证电脑               | 真实 Chrome、Python 3.10+、Jev 配置                                                                 | 宿主机方式需 uv；Docker 执行器方式需 Docker Compose |

服务器镜像内包含 Go 服务、Web 和 Linux 版 CLI，但不会给成员电脑安装 CLI / Skill，也不会自动执行测试。业务代码、浏览器和个人飞书授权留在成员电脑上。平台运行本身不需要模型 API Key。

当前仓库没有自动分发各平台 CLI 的安装包，默认通过源码安装。以下成员安装步骤面向 macOS / Linux shell，未验证 Windows 原生命令流程。

## 2. 准备服务器

### 2.1 安装依赖

按服务器系统安装 Git、make 和 curl。Ubuntu / Debian 可执行：

```sh
sudo apt-get update
sudo apt-get install -y git make curl
```

Docker 使用官方的 [Ubuntu 安装指南](https://docs.docker.com/engine/install/ubuntu/)或[其他 Linux 发行版指南](https://docs.docker.com/engine/install/)，同时安装 Buildx 和 Compose 插件。部署用户须能访问已启动的 Docker daemon。

Compose 使用 `docker compose` 命令，需支持顶层 `include`。按 [Docker include 文档](https://docs.docker.com/compose/how-tos/multiple-compose-files/include/)使用 `2.20.3` 或更高版本。

Node.js 按[官方下载说明](https://nodejs.org/en/download)选择仓库锁定的 `26.7.0` 和服务器架构。现有 Make 入口在宿主机运行 Node 脚本，不能只安装 Docker。Go、pnpm 和前端构建依赖在镜像内安装。

安装后检查：

```sh
git --version
make --version
node --version
docker version
docker compose version
docker buildx version
```

首次构建需要访问 Docker 镜像仓库、npm registry 和 Go modules 下载源。服务器磁盘需同时容纳构建缓存、MySQL 中的全部附件和备份；仓库没有经过容量压测的硬件最低配置。

### 2.2 准备域名与访问范围

1. 确定平台入口，例如 `https://acceptances.example.com`，域名解析到入口服务器或公司网关。
2. 准备受成员浏览器和 CLI 信任的 TLS 证书。证书申请及续期沿用公司的证书服务或运维流程。
3. 在公司网络、VPN 或网关限制可访问人员。当前开放注册，所有登录用户能操作全部项目、报告和评审；没有角色、项目级授权、密码找回、账号停用或 SSO。
4. 若使用本文的宿主机代理，入口开放 HTTPS 443；80 仅按证书申请和跳转需要开放。应用 8765 保持回环监听，MySQL 不对外开放。

不要在现有共享数据卷上试跑首次部署。本机开发和部署默认都占用 8765，同一台机器需要先核对端口。

## 3. 获取源码并启动 Docker 服务

部署目录由运维选择。以下从当前目录克隆仓库，需要具备仓库访问权限：

```sh
git clone git@github.com:Chulan-824/acceptances.git
cd acceptances
git status --short
git rev-parse HEAD
export ACCEPTANCES_PUBLIC_ORIGIN=https://acceptances.example.com
make docker-up
docker compose -p acceptances -f deploy/compose.yaml ps
curl --fail --retry 15 --retry-delay 2 --retry-connrefused http://127.0.0.1:8765/health/ready
```

将示例域名替换为实际值。`ACCEPTANCES_PUBLIC_ORIGIN` 是不带业务路径、查询参数的完整源地址；远程入口必须为 HTTPS。本项目不提供 `/acceptances` 这样的子路径部署方案。

`make docker-up` 会执行：

1. 在私有 `.cache/mysql` 目录生成数据库凭据，已有凭据则复用。
2. 从当前工作区构建前端、Go 服务和 CLI 镜像，未提交的源码也可能进入镜像。
3. 启动 `mysql`，等待数据库健康后启动 `app`；首次空库自动初始化，已有库按迁移版本升级。

最终以 ready 接口和页面检查判断是否就绪，不能只看 Make 返回成功。容器默认发布 `127.0.0.1:8765:8765`。当前 Compose 只给 MySQL 配置了容器健康检查，应用就绪需由上述 HTTP 检查或外部监控确认。

部署入口不会自动安装服务器服务管理器。公共域名建议由运维服务配置持久注入；本文使用 shell 环境变量明确传入配置，不依赖 Compose 的隐式 `.env` 加载。后续新开终端、更新或重新创建容器时，都要重新设置相同的 `ACCEPTANCES_PUBLIC_ORIGIN`。

## 4. 配置 HTTPS 反向代理

以下假设 Nginx 运行在与 Docker 相同的宿主机，域名证书已就绪。Ubuntu / Debian 可用 `sudo apt-get install -y nginx` 安装。将下面的配置放入 Nginx 已启用的站点目录，替换域名与证书路径：

```nginx
server {
    listen 443 ssl;
    server_name acceptances.example.com;

    ssl_certificate /etc/nginx/certs/acceptances.fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/acceptances.key;

    client_max_body_size 256m;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

检查配置成功后再重载：

```sh
sudo nginx -t && sudo systemctl reload nginx
curl --fail https://acceptances.example.com/health/ready
```

`Host` 必须与公共源地址一致，否则应用可能返回 `LOCAL_HOST_REQUIRED`。保留浏览器原有 `Origin`，不要通过代理伪造它。Nginx 的配置行为见 [proxy_set_header](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header)。

报告包含截图、视频等附件。应用整包上传上限为 256 MiB，代理需配置相应的请求体上限和超时；上游网关也要同步检查。Nginx 默认请求体限制较小，见 [client_max_body_size](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)。

若代理本身也运行在容器内，它的 `127.0.0.1` 指向代理容器，不能直接套用此配置，需要运维另行配置到应用的网络连接。本文不修改现有 Compose 网络。

## 5. 首次使用 Web

在成员电脑打开实际 HTTPS 域名，注册账号并登录，创建 Project，再创建 Campaign。只做查看和人工评审的成员到这里即可。

首次上线用专用测试项目核对：注册登录、创建需求、上传一份带附件的报告、打开证据和逐项评审。测试数据与日常报告分开。ready=200 只证明服务和数据库租约可用，不证明上述业务流程已验收。

## 6. 成员安装 CLI 和 Skill

### 6.1 从同版本源码安装

在每位执行验证的成员电脑克隆本仓库，尽量使用与服务器相同的已验证源码版本。安装 Git、Python 3、make 和 Go `1.26.8`，Go 安装方式见[官方说明](https://go.dev/doc/install)。在本仓库根目录执行：

```sh
python3 --version
go version
make install-skill
export PATH="$HOME/.local/bin:$PATH"
acceptances version
acceptances help
```

安装器会构建当前电脑可运行的 CLI，并安装完整 Skill 及其引用文件：

| 内容             | 默认位置                              |
| ---------------- | ------------------------------------- |
| CLI              | `~/.local/bin/acceptances`            |
| Codex Skill      | `~/.codex/skills/Acceptances-Cl`      |
| Skill 内附的 CLI | 上述 Skill 目录下的 `bin/acceptances` |

设置了 `CODEX_HOME` 时，Skill 安装到该目录的 `skills/Acceptances-Cl`。实际位置以安装回执为准。将 PATH 配置写入自己所用 shell 的启动文件，再重新加载 Agent 技能列表或新开聊天。

默认已安装时拒绝覆盖。更新用 `make replace-skill`，它同时替换 CLI 与 Skill，不会自动更新其他电脑。若使用其他支持 Skill 的 Agent，可以用安装器指定其技能目录，路径须按该工具的规则确认：

```sh
python3 scripts/v1/install-skill.py --destination /实际的技能根目录/Acceptances-Cl
```

需要覆盖时加 `--replace`。仍使用旧名 `acceptances-v1` 的电脑，应人工核对并移除重复旧 Skill，避免 Agent 加载两套流程。不要从服务器容器直接复制 Linux CLI 到 macOS。

### 6.2 登录平台

先在 Web 注册，再在成员自己的终端执行。下面通过 Python 隐藏密码输入，并经 stdin 传给 CLI，用户名替换为自己的账号：

```sh
python3 -c 'import getpass,sys; sys.stdout.write(getpass.getpass("平台密码："))' \
  | acceptances login --url https://acceptances.example.com --username your-name --password-stdin
acceptances whoami --url https://acceptances.example.com
```

不要把密码放进命令参数或聊天。Web 登录和 CLI 登录独立；会话按服务地址保存，有效期七天，过期后重新登录。平台关联与会话保存在操作系统的用户配置目录；不要求在业务仓库写入配置。`acceptances logout --url https://acceptances.example.com` 撤销当前 CLI 会话。

### 6.3 关联业务仓库

以下在要验证的业务目录执行，不是在 Acceptances 源码目录执行：

```sh
cd /实际的业务仓库
acceptances projects --url https://acceptances.example.com
acceptances link --url https://acceptances.example.com --project 项目ID
acceptances context
```

项目 ID 从上一条结果获取。关联保存后，后续命令复用平台地址和 Project；同一仓库的 worktree 共用关联，不同仓库可以关联到同一 Project。同源 Docker 部署无需另外配置 `--web-url`。

在已加载 Skill 的 Agent 聊天中使用：

> 使用 $Acceptances-Cl，验证当前需求并保存报告。需求依据是……，验证环境是……，归属 Campaign 是……。

验证在业务电脑执行，报告和证据上传至服务器。保存报告不代表人工接受，修复业务代码需要单独的修复授权。完整工作流见 [Agent 接入](agents/v1-integration.md)。

## 7. 可选：从飞书导入 PRD

### 7.1 安装并授权个人 Lark CLI

只有需要飞书导入的成员才安装。当前连接器在启动时严格检查 `1.0.98`，不能直接使用其他版本。可通过 npm 安装固定版本，或从[官方 v1.0.98 发布页](https://github.com/larksuite/cli/releases/tag/v1.0.98)取得匹配操作系统和架构的二进制。

```sh
npm install -g @larksuite/cli@1.0.98
lark-cli --version
lark-cli config init
lark-cli auth login --domain docs --domain drive --domain wiki
lark-cli auth status --json --verify
```

npm 方式需要成员电脑安装 Node.js / npm；二进制方式不需要 Node。官方安装入口见 [Lark CLI 说明](https://www.larksuite.com/en_us/blog/lark-cli)。已有有效应用配置时跳过 `config init`，按团队应用方案完成配置，不要重复创建应用；应用密钥只在成员电脑本地输入。个人授权命令由成员在自己的终端执行并按提示完成浏览器授权。

核对当前 profile 和 `user` 身份有效，确保本人能打开目标文档。授权包含用户同意和应用权限开通两部分，管理员审批未完成时，重复登录不能解决缺权限。上面的业务域授权可能包含额外权限，授权页需核对范围；按团队策略也可改用已确认的具体只读 scope。

若 PRD 含嵌入 Sheet，应用还需开通 `sheets:spreadsheet:read`，个人执行增量授权：

```sh
lark-cli auth login --scope "sheets:spreadsheet:read"
```

只通过 Acceptances 连接器导入时，无需安装整套 Lark Skills。若还需要 Agent 直接操作飞书，再按对应工具安装它们。

### 7.2 保持连接器在线并导入

先按第 6 节安装 Acceptances CLI、登录与 Web 相同的平台账号，再在任意目录运行：

```sh
acceptances lark connect --url https://acceptances.example.com --name 我的工作电脑
```

保持终端和电脑在线。在 Web 的 Campaign PRD 区填写 Docx 或指向 Docx 的 Wiki 链接，选择自己的在线电脑，读取后核对预览和缺失项，再确认导入。不要求关联业务仓库。

连接器由成员电脑主动访问服务器，服务器不需要访问成员电脑的入站端口，也不保存个人飞书 token。电脑睡眠、连接器退出或平台登录过期都会影响导入，处理后重新启动连接器。

当前确认后的 PRD 对所有平台登录用户共享，飞书原文后来撤权不会自动删除平台快照。支持范围与缺口见 [Lark 导入合同](../contracts/lark-prd.md)。

## 8. 可选：真实浏览器与 Jev

普通报告归档不要求 Jev。需要浏览器验证时，在执行验证的成员电脑配置已授权的真实浏览器工具。不要把浏览器或模型 Key 装在平台服务器上当成默认依赖。

选择 Jev 时按 [Jev 接入与任务合同](agents/jev-browser.md)操作。宿主机方式的入口为：

```sh
make jev-config
make jev-setup
make jev-doctor
```

Docker 执行器使用 `make jev-docker-build` 和 `make jev-docker-doctor`，仍连接成员电脑的真实 Chrome。Key 由用户在本机配置，Agent 不读取或打印 `.env*`。当前 Jev 任务入口只支持本机 HTTP 页面，不能用它验收远程 HTTPS 平台；远程页面继续使用原有真实浏览器工具。

## 9. 日常运维、备份和升级

以下命令均在服务器仓库根目录执行。

### 9.1 查看状态与恢复服务

```sh
docker compose -p acceptances -f deploy/compose.yaml ps
docker compose -p acceptances -f deploy/compose.yaml logs --tail=100 app
docker compose -p acceptances -f deploy/compose.yaml logs --tail=100 mysql
```

现有 Compose 没有 `restart` 策略，也没有开机启动配置。服务器重启或进程退出后，不应假定应用会自动恢复；运维需另行设置服务管理与监控。手动恢复已有镜像和数据时：

```sh
export ACCEPTANCES_PUBLIC_ORIGIN=https://acceptances.example.com
docker compose -p acceptances -f deploy/compose.yaml up --no-build -d
curl --fail --retry 15 --retry-delay 2 --retry-connrefused http://127.0.0.1:8765/health/ready
```

`restart app` 只重启原容器，不加载源码和新环境变量。MySQL 租约丢失时，先确认数据库恢复，再重启应用并检查 ready；一个数据库只允许一个应用实例，不能直接增加应用副本。

### 9.2 备份

`acceptances_mysql-data` 保存业务元数据、账号、报告及完整证据文件；`.cache/mysql` 保存数据库凭据。`acceptances_app-data` 用于旧附件兼容，未完成附件迁移前必须一并保留。

以下示例针对已使用数据库文件存储的部署，先停止应用写入，保留 MySQL 运行。每步确认成功后再继续：

```sh
docker compose -p acceptances -f deploy/compose.yaml stop app
umask 077
backup_dir=".cache/backups/deploy-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
docker compose -p acceptances -f deploy/compose.yaml exec -T mysql sh -c \
  'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" exec mysqldump -u root --single-transaction --no-tablespaces --hex-blob --routines --triggers --set-gtid-purged=OFF acceptances' \
  > "$backup_dir/archive.sql.partial" \
  && mv "$backup_dir/archive.sql.partial" "$backup_dir/archive.sql"
tar -czf "$backup_dir/mysql-credentials.tgz" .cache/mysql
git rev-parse HEAD > "$backup_dir/source-commit.txt"
```

只有导出退出成功并生成 `archive.sql` 才算完成 SQL 备份。`.partial` 不是可用备份。凭据由容器内从 secret 读取，不把明文密码放进宿主机命令或日志。备份包含账号和业务资料，应加密保管并复制到服务器之外，同时记录镜像版本、公共域名和代理配置。

若不是立即升级，按 9.1 节恢复应用。不要运行 `down -v`，也不要删除 `.cache/mysql` 后重新生成凭据。复制运行中的 MySQL 数据目录不能代替一致性备份。

### 9.3 在独立环境验证恢复

在另一台隔离服务器准备相同源码版本和依赖，确认没有既有业务库与卷。将备份包放到私有目录，在该仓库根目录先恢复 `.cache/mysql`，再启动数据库：

```sh
umask 077
tar -xzf /私有备份目录/mysql-credentials.tgz
node scripts/v1/mysql.mjs prepare
docker compose -p acceptances -f deploy/compose.yaml up -d --wait mysql
docker compose -p acceptances -f deploy/compose.yaml exec -T mysql sh -c \
  'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" exec mysql -u root acceptances' \
  < /私有备份目录/archive.sql
```

此导入会改写目标库，只能针对上述空白隔离环境执行。导入成功后，用该环境自己的 HTTPS 域名运行 `make docker-up`，核对表和文件内容、已有账号登录、报告附件、冻结交付与文档读取。旧附件后端还要恢复配套应用卷，步骤见 [MySQL 存储与恢复](mysql-storage.md)。

恢复验证未通过前，不把备份视为已验证的恢复方案。本文命令没有在本次文档整理中实际执行。

### 9.4 更新版本

1. 记录当前源码提交和镜像，停止写入，按 9.2 节备份并确认恢复方案。
2. 在服务器更新到已审核的目标源码，核对工作区差异；不要在部署机混入临时修改。
3. 设置原有公共入口，执行 `ACCEPTANCES_PUBLIC_ORIGIN=https://acceptances.example.com make docker-rebuild`。
4. 核对 ready、`/api/v1/capabilities` 返回的构建身份，以及登录、报告附件和人工评审。使用专用测试数据。
5. 各成员电脑更新同版本源码并运行 `make replace-skill`；已运行的飞书连接器需重新启动。

结构迁移随服务启动执行。迁移失败或 dirty 状态会阻止启动，不允许通过删卷重试；数据库结构变化后，单纯退回旧镜像不保证兼容，回退需使用已验证的数据库与附件恢复方案。

从本机已有数据迁到服务器时，同样走停写、完整备份、独立恢复核对的流程。`make mysql-files-migrate` 只面向本地开发库，不是部署库迁移命令；旧 MySQL 附件后端需按 [存储迁移说明](mysql-storage.md)单独处理。当前不提供 SQLite 导入。

## 10. 上线核对与常见问题

| 检查或现象                                   | 判断与处理                                                    |
| -------------------------------------------- | ------------------------------------------------------------- |
| 公共入口能打开、ready 返回 200               | 继续验证真实登录及业务操作，不能只以进程或首页判断上线成功    |
| 服务器自己能访问，成员打不开                 | 核对 DNS、HTTPS 代理和网络策略；8765 默认仅绑定服务器回环地址 |
| `LOCAL_HOST_REQUIRED` / `ORIGIN_NOT_ALLOWED` | 核对公共源、Host 和浏览器 Origin；修改配置后重新创建应用容器  |
| CLI 提示远程登录要求 HTTPS                   | 使用完整 HTTPS 源地址，不使用远程 HTTP IP 地址                |
| CLI 401 或网页显示已登录但上传失败           | CLI 与 Web 会话独立，成员对实际 API 地址重新登录              |
| 上传返回 413 或超时                          | 核对入口网关和 Nginx 的请求体、超时配置及应用整包上限         |
| `acceptances` 找不到 / Agent 看不到 Skill    | 核对安装回执、PATH、Agent 的技能目录并重新加载                |
| 已有 MySQL 卷但凭据丢失                      | 恢复原 `.cache/mysql`，不删除卷或重新生成密码                 |
| `archive is already in use` / 租约丢失       | 核对是否有另一实例占用同库或数据库重启；恢复数据库后重启应用  |
| 飞书电脑列表为空                             | 同一平台账号启动连接器，确认电脑在线、CLI 会话有效            |
| `LARK_CLI_VERSION_UNSUPPORTED`               | 连接器目前只接受 `1.0.98`                                     |
| `LARK_SCOPE_REQUIRED`                        | 同时核对应用审批和个人增量授权，完成后重新导入                |

发布前可按 [工具链指南](toolchain.md)运行 `make release-check`，在隔离 Docker 项目检查构建与静态资源。它不部署服务器，也不覆盖真实域名、证书、成员电脑、真实飞书权限和完整业务验收。正式产品验收按 [T1–T9 交接](v1-implementation-handoff.md)记录。
