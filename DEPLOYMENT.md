# Ubuntu 内网 Docker 离线部署

本机执行 `make docker-package VERSION=2026.10.26-1`，将生成的目录传到服务器，校验后执行 `docker load` 和 `docker compose up`。服务器只运行已构建镜像，不需要仓库源码、Node.js、Go、pnpm 或 make。

本文按 Ubuntu **64 位 x86** 服务器编写，目标平台固定为 `linux/amd64`。适用于一台服务器、一个应用实例和一个 MySQL。示例版本号、服务器地址、域名均需替换为实际值。更新日期为 2026-10-26。

## 1. 核对服务器版本和访问入口

在服务器执行：

```sh
cat /etc/os-release
uname -m
docker version
docker compose version
df -h /var/lib/docker /opt
```

- `uname -m` 应返回 `x86_64`。`i386`、`i686` 是 32 位系统，不能运行本部署包；`aarch64` 是 ARM，需要另行构建。
- 按实际 Ubuntu 版本安装 Docker Engine 和 Compose 插件，使用 `docker compose`，不使用旧的 `docker-compose`。本文以 Compose 2.20.3 及以上为操作基线，安装支持该 Ubuntu 版本的 Docker Engine。参考 [Docker 官方 Ubuntu 安装说明](https://docs.docker.com/engine/install/ubuntu/)。
- 服务器还需 `curl`、`openssl`、`tar`、`sha256sum` 和 SSH。无外网时，由运维提前准备匹配 Ubuntu 发行版和 amd64 架构的 Docker、Compose 及上述工具的离线安装包；应用镜像包不包含宿主机安装器。
- 部署账号需要访问 Docker daemon，并有 `/opt/acceptances` 写权限。通过公司运维流程授予权限。
- 预留空间供新旧两套镜像、导入时的临时空间、全部附件与数据库备份使用。本项目没有经过容量压测的硬件最低配置。

宿主机不必与镜像内的 Debian 版本相同。CPU 架构、宿主机内核和 Docker 对该 Ubuntu 版本的支持需要匹配；不能仅凭“Ubuntu”判断兼容。先检查目标服务器，不要直接升级服务器系统或 Docker。

团队入口使用公司内网 HTTPS 域名，例如 `https://acceptances.company.example`。当前应用拒绝远程 HTTP 源地址，浏览器和成员 CLI 都需要信任入口证书。没有公网也可以使用公司 CA 或公司 HTTPS 网关，证书配置不包含在镜像包内。

默认应用只发布服务器 `127.0.0.1:8765`，由同机 Nginx 或公司网关的同机代理转发；MySQL 不发布宿主机端口。若网关在另一台机器，先通过运维确定受限网络连接方式，不能直接把网关的 `127.0.0.1` 当作本服务器。

当前开放注册，全部登录用户共享所有项目与操作，没有项目级权限、账号停用或 SSO。入口须限制在获授权的公司网络或 VPN 范围。

## 2. 服务器首次准备目录

以下采用 `/opt/acceptances`。先由运维创建目录并交给部署账号：

```sh
sudo install -d -m 0750 -o "$(id -un)" -g "$(id -gn)" /opt/acceptances
install -d -m 0750 /opt/acceptances/releases
install -d -m 0700 /opt/acceptances/shared /opt/acceptances/backups
sudo systemctl enable --now docker
```

部署后的目录：

```text
/opt/acceptances/
  releases/
    2026.10.26-1-linux-amd64/
      images.tar
      compose.json
      release.json
      runtime.conf.example
      SHA256SUMS
      DEPLOYMENT.md
  shared/
    runtime.conf
    mysql/
      password
      root-password
      docker.dsn
  backups/
  current -> releases/2026.10.26-1-linux-amd64
  previous -> releases/上一版本目录
```

Docker 命名卷 `acceptances_mysql-data` 保存账号、报告、PRD、交付和完整附件，`acceptances_app-data` 保留旧附件兼容目录。镜像和版本目录不保存业务数据。后续命令固定使用 Compose 项目名 `acceptances`，不得每次换版本就换项目名，否则会连接另一组空卷。

## 3. 本地构建并打包

构建电脑需要 Git、make、仓库锁定的 Node.js `26.7.0`，以及已启动的 Docker 和 Buildx。Go、pnpm 和前端依赖在 Dockerfile 中准备，无需先执行本机 `make build`。

本机需要访问锁定的基础镜像、npm 和 Go modules 源。macOS Apple Silicon 也固定构建 `linux/amd64`，由 Docker 的跨架构能力执行，首次构建可能较慢。先检查 builder 支持目标平台，参考 [Docker 多平台构建](https://docs.docker.com/build/building/multi-platform/)。

在本仓库根目录执行：

```sh
node --version
docker buildx ls
git status --short
git rev-parse HEAD
make docker-package VERSION=2026.10.26-1
```

打包入口会：

1. 运行打包配置单测，从当前工作区冻结源码副本，排除 `.env*`、Git 元数据和被忽略的本机产物。未提交文件与修改会进入副本，并在回执中标记 dirty；正式部署前先审查工作区。
2. 使用现有 `deploy/Dockerfile` 构建 amd64 应用，注入 commit、dirty 和 API 源码摘要。
3. 拉取现有 Compose 锁定 digest 的 amd64 MySQL 镜像，为离线加载生成固定本地标签。
4. 从现有 Compose 生成 `compose.json`，保留运行用户、只读文件系统、secret 挂载、卷、数据库健康检查和启动顺序，移除构建上下文。仅服务器配置增加 `unless-stopped` 重启策略和容器日志轮转。
5. 生成 `images.tar`、`release.json` 和 `SHA256SUMS`。归档包含应用与 MySQL，不包含本机凭据、运行数据或个人飞书授权。

结果位于：

```text
artifacts/docker/2026.10.26-1-linux-amd64/
```

应用标签为 `acceptances:2026.10.26-1-amd64`。MySQL 标签包含其锁定 digest 的前缀和架构，完整上游 digest、镜像 ID、源码文件清单与摘要保存在 `release.json`。应用的 capabilities 中 `version` 仍是代码内版本，实际发布批次以镜像标签、镜像 ID 和 `release.json` 为准。

每次发布使用新的 VERSION，例如 `2026.10.26-2`。入口拒绝覆盖已有输出目录或本机已有的同版本应用标签。失败目录及镜像保留供排查，缺少完整 `SHA256SUMS` 的目录不能部署；修复后换新版本号重新打包。构建期间不要修改源码。

打包只构建和导出镜像，不自动部署服务，也不代表业务验收通过。发布前的隔离构建烟测可执行 `make release-check`，覆盖范围见仓库的[工具链说明](docs/toolchain.md)。

## 4. 传到服务器并加载

本地执行，将用户名和地址替换为真实服务器：

```sh
scp -r artifacts/docker/2026.10.26-1-linux-amd64 \
  deploy@your-intranet-server:/opt/acceptances/releases/
```

通过公司文件传输渠道或移动介质也可以，必须完整保留目录。服务器执行：

```sh
set -eu
deployment=/opt/acceptances
release=2026.10.26-1-linux-amd64
cd "$deployment/releases/$release"
sha256sum -c SHA256SUMS
docker load --input images.tar
docker image inspect acceptances:2026.10.26-1-amd64 \
  --format '{{.Id}} {{.Os}}/{{.Architecture}}'
```

每一项校验必须为 `OK`，镜像架构为 `linux/amd64`。将应用和 MySQL 的 image ID 与 `release.json` 中 `images` 对应记录逐一核对。每个服务的镜像标签可在 `compose.json` 中查看，再用同样的 `docker image inspect` 检查。SHA-256 用于检查传输完整性，发布包仍应从可信构建电脑经授权渠道传输。

包内 Compose 设置 `pull_policy: never`，镜像缺失会直接失败，不会联网拉取。镜像归档和加载的行为见 [docker image save](https://docs.docker.com/reference/cli/docker/image/save/) 与 [docker image load](https://docs.docker.com/reference/cli/docker/image/load/)。不要使用 `docker export/import`，它不保留同等镜像元数据。

## 5. 首次生成配置与数据库凭据

本节只适用于**没有既有数据库和凭据的首次部署**。已有本机或服务器数据需要迁移时，先按第 10 节恢复，不运行初始化块。

服务器在上节终端中复制配置，然后编辑实际域名和凭据目录：

```sh
test ! -e "$deployment/shared/runtime.conf"
cp runtime.conf.example "$deployment/shared/runtime.conf"
chmod 600 "$deployment/shared/runtime.conf"
vi "$deployment/shared/runtime.conf"
```

配置内容如下，只包含非密码配置：

```ini
ACCEPTANCES_PUBLIC_ORIGIN=https://acceptances.company.example
ACCEPTANCES_SECRETS_DIR=/opt/acceptances/shared/mysql
```

源地址必须完整，不带路径、查询参数或结尾斜杠。不支持 `/acceptances` 子路径部署。后续每次使用同一配置文件，新版本包内的 example 不覆盖它。

首次生成私有凭据，在服务器执行整个代码块：

```sh
set -eu
deployment=/opt/acceptances
secrets_dir="$deployment/shared/mysql"
docker info >/dev/null
if [ -e "$secrets_dir" ] || [ -L "$secrets_dir" ]; then
  echo '凭据目录已存在，停止初始化；请复用或恢复原凭据。' >&2
  exit 1
fi
volumes="$(docker volume ls --format '{{.Name}}')"
if printf '%s\n' "$volumes" | grep -qx acceptances_mysql-data; then
  echo '数据库卷已存在，停止初始化；必须恢复与该库匹配的原凭据。' >&2
  exit 1
fi
umask 077
mkdir -m 700 "$secrets_dir"
openssl rand -hex 32 > "$secrets_dir/password"
openssl rand -hex 32 > "$secrets_dir/root-password"
printf 'acceptances:%s@tcp(mysql:3306)/acceptances?charset=utf8mb4&parseTime=true&loc=UTC' \
  "$(cat "$secrets_dir/password")" > "$secrets_dir/docker.dsn"
chmod 644 "$secrets_dir/password" "$secrets_dir/root-password" "$secrets_dir/docker.dsn"
```

父目录必须保持 0700。文件设为 0644 是因为 Compose 文件 secret 使用绑定挂载，非 root 应用需要读取文件；外层私有目录限制宿主机其他用户访问，与仓库已有凭据机制一致。不要打印文件、使用 `set -x` 或把它们复制进版本包。凭据一旦生成，后续升级继续复用，重新生成不会改变已有 MySQL 用户的密码。

## 6. 启动和验证

服务器定义一个命令缩写。新开终端时重新执行此块，明确选定要操作的版本：

```sh
deployment=/opt/acceptances
release=2026.10.26-1-linux-amd64
dc() {
  docker compose --env-file "$deployment/shared/runtime.conf" \
    --project-name acceptances \
    -f "$deployment/releases/$release/compose.json" "$@"
}
dc config --quiet
dc up -d --no-build --pull never --wait --wait-timeout 180
dc ps
curl --fail --retry 30 --retry-delay 2 --retry-connrefused \
  http://127.0.0.1:8765/health/ready
curl --fail http://127.0.0.1:8765/api/v1/capabilities
docker inspect "$(dc ps -q app)" --format '{{.Image}}'
```

`--wait` 检查 MySQL 健康和应用进程状态，应用本身没有容器健康检查，因此必须再检查 ready。capabilities 的 commit、dirty 和 sourceDigest 应与 `release.json` 的 build 一致，实际容器镜像 ID 应与该版本应用镜像 ID 一致。

首次空库自动初始化，已有库按镜像内迁移升级。服务和数据库均配置 `unless-stopped`；Docker daemon 开机启动后会尝试恢复未被手动停止的容器。启动依赖检查不等于持续监控。MySQL 重启可能使应用失去数据库租约，此时先确认 MySQL 健康，再执行 `dc restart app` 并复查 ready。一个数据库只能运行一个应用实例，不能增加副本进行滚动更新。

## 7. 配置公司 HTTPS 入口

已有公司网关时由运维配置同等行为。以下为同机 Nginx 的最小站点配置，域名、证书和启用目录按公司环境调整。服务器没有外网时提前安装 Nginx 的离线包。

```nginx
server {
    listen 443 ssl;
    server_name acceptances.company.example;

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

```sh
sudo nginx -t && sudo systemctl reload nginx
curl --fail https://acceptances.company.example/health/ready
```

代理保留实际 Host 和浏览器 Origin，Host 应匹配公共入口。参考 [Nginx 代理请求头](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header)。上传整包上限为 256 MiB，上游网关同步设置请求体和超时限制，参考 [Nginx 请求体限制](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)。

在成员电脑用真实浏览器检查注册登录、创建专用测试项目与需求、上传一份带附件报告、证据读取、逐项评审。再检查成员 CLI 登录和上传。不要用日常报告试验删除或评审。健康接口和静态检查不能替代这些业务验收。

首次上线验证通过后，标记当前版本：

```sh
ln -sfn "releases/$release" "$deployment/current"
```

只做浏览和评审的成员无需安装其他工具；归档报告的成员另行安装 CLI/Skill，飞书导入连接器也运行在成员电脑。安装和登录操作见仓库的[服务器部署与成员安装手册](docs/deployment.md#6-成员安装-cli-和-skill)。平台更新不会自动更新成员 CLI 或正在运行的连接器。

## 8. 日常查看和备份

先定义第 6 节的 `dc`，再从 current 明确选取当前版本，不要把刚传输的新包误当作正在运行的版本：

```sh
deployment=/opt/acceptances
test -L "$deployment/current"
release="$(basename "$(readlink -f "$deployment/current")")"
```

首次上线尚未创建 current 时，手动将 release 设为已核对的运行版本。

```sh
dc ps
dc logs --tail=100 app mysql
dc restart app
```

`restart` 只重启旧容器，不更新镜像、配置或环境变量。停止维护使用 `dc stop app`；该操作会停止应用的自动恢复，维护后需要显式 `dc up`。容器日志按每文件 10 MiB、最多三份轮转，长期日志另行归档。**不要执行 `down -v`、删除数据卷或清理 shared 目录。**

每次升级前停写并做完整备份。以下命令在服务器运行，逐步确认成功；失败时保持停写并排查：

```sh
set -eu
umask 077
backup="$deployment/backups/$(date +%Y%m%d-%H%M%S)-$release"
mkdir -m 700 "$backup"
dc stop app
dc exec -T mysql sh -c \
  'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" exec mysqldump -u root --single-transaction --no-tablespaces --hex-blob --routines --triggers --set-gtid-purged=OFF acceptances' \
  > "$backup/archive.sql.partial"
mv "$backup/archive.sql.partial" "$backup/archive.sql"
dc exec -T mysql sh -c \
  'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" exec mysql -u root acceptances -e "SELECT version,checksum,dirty FROM schema_migrations ORDER BY version"' \
  > "$backup/schema-before.txt"
tar -C "$deployment/shared" -czf "$backup/shared.tgz" mysql runtime.conf
cp "$deployment/releases/$release/compose.json" "$backup/compose.json"
cp "$deployment/releases/$release/release.json" "$backup/release.json"
```

上述 SQL 包含数据库中的全部文件。`archive.sql.partial` 不是完成的备份；导出退出成功且重命名后才可使用。复制运行中的 MySQL 数据目录不能代替此备份。

若从历史版本沿用文件系统附件，需要额外备份 `acceptances_app-data`，并按仓库[MySQL 存储与恢复](docs/mysql-storage.md)确认文件后端和迁移状态。本文新建实例默认在 MySQL 保存完整文件。

备份应加密保管并复制到另一台机器，连同该版本部署包、公司入口配置和证书恢复方案保存。shared 包含数据库凭据，按敏感资料管理。先在独立环境完成第 10 节恢复演练，再将其视为可靠恢复方案。

备份后如果不立即升级：

```sh
dc up -d --no-build --pull never --wait --wait-timeout 180
curl --fail --retry 30 --retry-delay 2 --retry-connrefused \
  http://127.0.0.1:8765/health/ready
```

## 9. 发布更新和回滚

### 9.1 发布新镜像

1. 本地审核源码和数据库迁移，使用新 VERSION 构建，例如 `make docker-package VERSION=2026.10.26-2`。按第 4 节传输、校验并加载新包，核对两张镜像的 ID 和架构。此时不影响运行中的旧容器。
2. 比较新旧 `release.json` 的 `mysqlUpstream` 和数据库镜像 ID。常规应用升级保持 MySQL 版本及 digest 不变；如有变化，暂停本节，先安排独立的数据库升级、恢复演练和维护窗口。不能把 MySQL 升级当作应用换包顺带执行。
3. 按第 8 节从 current 重新选取旧 `release`，停止应用并完成备份，记录旧版本目录。更新期间有维护停机，不做双实例切流。
4. 切换变量到新版本，只重建应用，保留运行中的数据库：

```sh
old_release="$release"
release=2026.10.26-2-linux-amd64
dc config --quiet
dc up -d --no-build --pull never --no-deps --force-recreate app
dc ps
curl --fail --retry 30 --retry-delay 2 --retry-connrefused \
  http://127.0.0.1:8765/health/ready
curl --fail http://127.0.0.1:8765/api/v1/capabilities
docker inspect "$(dc ps -q app)" --format '{{.Image}}'
```

确认 MySQL 仍健康；核对新容器镜像 ID、构建身份及实际 HTTPS 页面。用专用数据验证登录、报告及附件和评审。验证通过后更新标记：

```sh
ln -sfn "releases/$old_release" "$deployment/previous"
ln -sfn "releases/$release" "$deployment/current"
```

不要立即删除上一版本的镜像、部署包或升级前备份。成员按需要更新 CLI/Skill 并重启飞书连接器。若修改公共域名或凭据路径，先更新 shared 配置并重新创建应用；更换实际数据库密码还需要同步修改数据库账户，不能仅改文件。

### 9.2 回滚应用镜像

迁移随新应用启动自动执行，MySQL DDL 会隐式提交。**即使新应用没有启动成功，也不能假定数据库未变化。** 迁移失败会保留 dirty 状态并拒绝后续启动。

先停止失败版本，再查看当前结构：

```sh
dc stop app
dc exec -T mysql sh -c \
  'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" exec mysql -u root acceptances -e "SELECT version,checksum,dirty FROM schema_migrations ORDER BY version"'
```

只有确认迁移版本与 checksum 没变、全部 dirty=0、旧版本兼容当前数据，并且新版本未产生不兼容写入时，才能只回滚镜像。与升级前 `schema-before.txt` 对照，必要时检查新版本数据写入逻辑。确认后使用真实旧目录名执行：

```sh
release="$old_release"
dc up -d --no-build --pull never --no-deps --force-recreate app
curl --fail --retry 30 --retry-delay 2 --retry-connrefused \
  http://127.0.0.1:8765/health/ready
```

验证旧版本业务和镜像身份通过后，再把 current 指回旧目录。新开终端时 `old_release` 不存在，需要从 previous、备份及记录中明确填写，不要猜版本。

结构已变化、dirty=1 或兼容性不明确时，保持停写，使用升级前完整备份和旧版本包恢复到独立环境。核对通过后由运维切换入口。恢复备份会丢弃备份时间之后的新增数据，需先确认损失范围；不要直接把 SQL 导入当前生产库来尝试回滚。

## 10. 恢复演练和已有数据迁移

优先使用另一台隔离 Ubuntu 服务器。将升级前的完整部署包和私有备份传到该机，检查 Docker、架构、校验清单并执行 `docker load`。以下以空白 `/opt/acceptances-restore` 和全新项目名 `acceptances-restore` 示范，**只能对无既有数据的目标执行**。

先确认不存在 `acceptances-restore_mysql-data`、`acceptances-restore_app-data` 卷和同项目容器。若存在，换一个已确认空白的项目名和目录，不能直接复用。恢复服务器的 8765 必须空闲。

```sh
set -eu
umask 077
restore=/opt/acceptances-restore
restore_release=2026.10.26-1-linux-amd64
backup=/私有备份目录/升级前备份
test ! -e "$restore"
docker info >/dev/null
volumes="$(docker volume ls --format '{{.Name}}')"
if printf '%s\n' "$volumes" | grep -Eq '^acceptances-restore_(mysql-data|app-data)$'; then
  echo '恢复目标卷已存在，请换用空白恢复环境。' >&2
  exit 1
fi
containers="$(docker ps -aq --filter label=com.docker.compose.project=acceptances-restore)"
test -z "$containers"
install -d -m 0700 "$restore/shared"
install -d -m 0750 "$restore/releases"
# 将已校验的旧版部署包放到 "$restore/releases/$restore_release"
tar -C "$restore/shared" -xzf "$backup/shared.tgz"
vi "$restore/shared/runtime.conf"
```

将恢复配置里的 `ACCEPTANCES_SECRETS_DIR` 改为 `/opt/acceptances-restore/shared/mysql`，PUBLIC_ORIGIN 改为恢复环境自己的 HTTPS 源地址。不要再生成密码。使用旧版本包中的配置，生成的卷与网络会随项目名隔离：

```sh
rc() {
  docker compose --env-file "$restore/shared/runtime.conf" \
    --project-name acceptances-restore \
    -f "$restore/releases/$restore_release/compose.json" "$@"
}
rc config --quiet
rc up -d --no-build --pull never --wait --wait-timeout 180 mysql
rc exec -T mysql sh -c \
  'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" exec mysql -u root acceptances' \
  < "$backup/archive.sql"
rc up -d --no-build --pull never --wait --wait-timeout 180
curl --fail --retry 30 --retry-delay 2 --retry-connrefused \
  http://127.0.0.1:8765/health/ready
```

导入后核对迁移表、业务记录数量及文件内容，使用既有账号检查历史报告、图片/视频、PRD、冻结交付和生成文档。涉及旧文件系统后端时，还要在启动应用前恢复配套应用卷。本文不提供 SQLite 导入。

从现有本机部署搬迁时同样先停写、备份并在新服务器恢复核对。源服务在迁移完成前保持停写，避免两套系统继续产生不同数据。公司 DNS 或网关切换前要确认最终数据和成员平台地址；CLI 登录与仓库关联也需指向新 HTTPS 地址。

## 11. 常见问题

| 现象                                        | 处理                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `exec format error`                         | 检查服务器是否 x86_64、两张镜像是否 linux/amd64，重新构建正确架构，不能靠换标签修复       |
| 离线启动提示镜像不存在                      | 检查完整 images.tar 已加载，服务标签与 release.json 一致；不要改成 latest 或打开自动拉取  |
| 更新后出现空项目列表                        | 先停应用，核对 Compose 项目名和卷是否误换；不要初始化或导入覆盖旧库                       |
| MySQL access denied                         | 检查是否复用原凭据及正确的卷；不能删除卷或随机重置密码文件                                |
| `LOCAL_HOST_REQUIRED`、`ORIGIN_NOT_ALLOWED` | 核对 PUBLIC_ORIGIN、代理 Host、浏览器 Origin 与真实 HTTPS 入口；修改配置后重新创建应用    |
| 远程 HTTP 登录失败                          | 使用受信任 HTTPS 入口；不要改代码绕过现有登录限制                                         |
| 上传 413 或超时                             | 核对公司网关和 Nginx 的 256 MiB 请求体上限及超时                                          |
| 数据库租约丢失                              | 确认 MySQL 健康且没有第二个应用实例，再重启应用检查 ready                                 |
| schema mismatch 或 dirty                    | 停写并核对实际迁移状态，按备份恢复流程处理，不手动删除迁移记录绕过                        |
| 重启后未恢复                                | 检查 Docker daemon、是否手动 stop 过容器，以及 MySQL 和应用 ready；重启策略不修复失效租约 |

容器重启与离线拉取策略参考 [Docker Compose 服务配置](https://docs.docker.com/reference/compose-file/services/)。本地构建或隔离容器验证不能证明目标 Ubuntu、公司证书、网络和真实业务已验收，首次部署必须完成第 6、7、10 节检查。
