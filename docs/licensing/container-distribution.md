# 容器组成与分发安排

2026-10-09 检查本地隔离候选镜像，未发布镜像或修改运行实例。当前新 V1 原创文件已按 [MIT 清单](mit-scope.json) 授权，历史与第三方内容仍各按其范围。本文只处理镜像组成，不代替 LobeHub 来源与项目权属判断。

## 实物核查

候选来自当前 `deploy/Dockerfile`，平台 linux/arm64。初次核查镜像 ID 和 88 个已安装 Debian 二进制包、63 个源包的精确版本见 [镜像清单](debian-image-inventory.json)。全部 88 个包的 `/usr/share/doc/<包>/copyright` 可读取，部分通过共享文档目录解析；清单记录实际路径和摘要。`/usr/share/common-licenses` 的 GPL、LGPL、MPL 等正文也存在。清单并未将一个包的全部文件归为单一许可，具体文件的条款仍以各包 copyright 为准。[Debian 官方政策](https://www.debian.org/doc/debian-policy/ch-docs.html#copyright-information)说明这两类路径的用途。

最终镜像是 Debian slim、两个 Go 程序、Web 静态资源、CA bundle 和许可材料。没有复制 Node/pnpm/Go 编译器或整个构建层。两个 ELF64 应用程序均无 PT_INTERP/PT_DYNAMIC，Go 构建信息是 `CGO_ENABLED=0`、linux/arm64、go1.26.8；服务链接前述 10 个 Go 模块，CLI 没有第三方 Go 模块。镜像中的 glibc 属于系统组件，不是这两个程序动态链接的库。此结果仅覆盖检查过的 arm64 产物，其他平台必须重查。

Debian 包原通知已随基础层保留。新配方把仓库许可材料放在 `/app/licensing`，另从固定 Go 构建层复制 `/usr/share/doc/ca-certificates/copyright` 到 `/app/licensing/ca-certificates/copyright`，补上此前只复制证书集合而漏掉来源通知的问题。没有删减系统工具以回避许可，也没有把整个操作系统统称 MIT。

## CA 的精确来源

实际包版本为 `20250419~deb12u1`，bundle SHA-256 是 `001013901ad4a466d4b1f6ed711939c1bad3fbddcd57b7d6ef31779075989ae3`。普通 Debian pool 的精确版本请求返回 404，后在官方 security archive 与 snapshot 找到相同版本，已下载并核对。精确 [源码归档](https://security.debian.org/debian-security/pool/updates/main/c/ca-certificates/ca-certificates_20250419~deb12u1.tar.xz) 的 SHA-256 与官方 .dsc 一致，归档内 debian/copyright 与构建层逐字节匹配；源码含 `mozilla/certdata.txt`。详见 [来源与校验记录](ca-source.json)，未独立验证 .dsc 的 PGP 签名。

包的版权说明区分 Debian 构建/更新脚本的 GPL-2+ 与 Mozilla certdata 的 MPL-2.0。最终镜像复制的是生成的证书集合，没有复制更新脚本。因此不把整个证书集合简单标成 GPL，也不声称运行生成器就让输出自动受生成器许可支配。保守保留完整包通知，并告知接收者从上述精确源码或 [历史版本入口](https://snapshot.debian.org/package/ca-certificates/20250419~deb12u1/) 获取可修改来源。MPL 2.0 第 3.2 节要求分发非源码形态时提供其源码取得方式，第 3.3 节允许更大作品采用其他条款；详见 [Mozilla 原文](https://www.mozilla.org/en-US/MPL/2.0/)。未来正式发行应镜像保存此源码，避免第三方链接失效。

## 本机使用与对外分发

| 操作范围                                    | 当前需要做什么                                                                                                  | 不能推导什么                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 自己构建、只在自己本机运行                  | 保留已有材料；不产生向其他接收者交付二进制的事实                                                                | 不能因此证明项目全部原创或免除上游其他适用限制                                          |
| 发布当前源码快照与 Dockerfile，用户自行构建 | 按已确认 MIT 清单与排除项，保留源码适用通知和构建材料来源；用户自行拉取基础镜像与自己向外分发成品镜像是不同事实 | 不能借源码快照掩盖实际沿用的第三方表达                                                  |
| 发布含历史的 Git 仓库                       | 额外处理旧 renderer/validator/skill 的衍生、修改通知和上游条件                                                  | 删除当前目录不删除历史分发内容                                                          |
| 发布构建后的镜像、镜像 tar 或交给另一接收者 | 随附系统/运行依赖/项目通知，对实际 GPL/LGPL 等覆盖的组件选择并落实源码交付方式                                  | 非商业分发也不是自动免除源码提供；仅有 Dockerfile 或“源码在 Debian”一句话不足以证明完成 |

GPL-2 第 2 节、GPL-3 第 5 节和 LGPL-2.1 第 2 节均区分单纯聚合与衍生作品。将独立程序一同放入镜像，不自动把整个 Acceptances 置于 GPL。普通本机运行也不等同向第三方分发。判断依据包括镜像内原始正文 `/usr/share/common-licenses/GPL-2`、`GPL-3`、`LGPL-2.1`；官方条款入口见 [GNU GPL-2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html)、[GPL-3](https://www.gnu.org/licenses/gpl-3.0.html) 和 [LGPL-2.1](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html)。本轮 GNU 网页抓取超时，实际阅读的是 Debian 随包原文。

## 发布镜像前的具体动作

建议采用“镜像与对应源码材料同时可下载”的发行方式，避免在本次未经决定时擅自签发长期书面 offer。按 63 个精确 Debian 源包版本获取 .dsc、原始归档和 Debian 补丁/构建文件，核对摘要，建立镜像 digest 到源包的映射，并保留 Go 模块及其他实际受条款要求的来源材料。处理 GPL-2 第 3 节、GPL-3 第 6 节、LGPL-2.1 第 4 节时，要按选定的交付方式满足对应条款；不能假定 Debian 或镜像生产者替本项目对接收者承担责任。GPL-2 的三年书面提供方式，以及非商业转交已有 offer 的例外，都有条件，不是默认选项。

当前已取得精确 CA 源码，尚未取得并校验其余 63 个系统源包的完整源码集，也尚未选定发行渠道及源码材料的持续提供安排。清单中的 snapshot 链接只是定位入口，不是已验证的源码包或本项目书面 offer。这是未来发布镜像的具体未完成事项，不妨碍当前本机检查，也不表示应把整个应用源码改用 GPL。无需改写用户已有 Git 历史；正式发行范围由用户决定后执行。
