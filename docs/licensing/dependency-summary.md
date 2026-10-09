# 第三方许可公开摘要

记录日期：2026-10-08。该摘要保留可公开的来源、精确版本声明和证据限制，不包含私有会话或内部规划。它不是全量依赖清单、最终发行材料包或许可合规认证。项目范围见根 [LICENSE-SCOPE.md](../../LICENSE-SCOPE.md)，LobeHub 原条款见 [Community License](../../LICENSES/LobeHub-Community-1c7a711.txt)及 [Apache 2.0](../../LICENSES/Apache-2.0.txt)。

本次补查的五个精确 npm 分发包的 integrity 与锁文件一致；声明只适用于对应包，不能替代本项目原创范围确认。

| 包与精确版本          | 声明、归属及公开来源                                                                                                                                                                                                                                                   | 已获得材料与限制                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| esrecurse 4.3.0       | [精确包元数据](https://registry.npmjs.org/esrecurse/4.3.0)声明 BSD-2-Clause；精确源码头为 Copyright (C) 2014 Yusuke Suzuki。                                                                                                                                           | [精确分发包](https://registry.npmjs.org/esrecurse/-/esrecurse-4.3.0.tgz)的 esrecurse.js 内嵌完整条款，不因缺少独立 LICENSE 就判为许可未知。                                                    |
| keyv 4.5.4            | [精确包元数据](https://registry.npmjs.org/keyv/4.5.4)／README 声明 MIT；源码匹配提交的 [LICENSE](https://github.com/jaredwray/keyv/blob/c38b5249341df741188d4036614e92b50a5bd96e/LICENSE)保留 Luke Childs 2017–2021 与 Jared Wray 2021–2022。                          | 分发 src/index.js／index.d.ts 与该提交逐字节匹配，但该提交 package version 是 4.5.3；没有 registry gitHead 或已证实的 4.5.4 tag。这是源码等价证据，不冒充精确版本标签。                        |
| natural-compare 1.4.0 | [精确包元数据](https://registry.npmjs.org/natural-compare/1.4.0)声明 MIT；[精确分发包](https://registry.npmjs.org/natural-compare/-/natural-compare-1.4.0.tgz) README 保留 Copyright 2012–2015 Lauri Rooden，链接 [作者条款](http://lauri.rooden.ee/mit-license.txt)。 | 作者链接无版本，2026-10-08 HTTP／HTTPS 获取文本相同；不声称历史页面状态已证实。                                                                                                                |
| uri-js-replace 1.0.1  | [精确包元数据](https://registry.npmjs.org/uri-js-replace/1.0.1)声明 MIT，author 为 https://github.com/andreinwald；gitHead 为 `38927505b51a74b53444dc723be10e0d2e53823c`。                                                                                             | 精确分发包及对应源码未发现独立 LICENSE／原版权行；标准 MIT 文本只能作为条款参考，不冒充上游原文件，不虚构版权姓名或年份。                                                                      |
| @humanfs/types 0.15.0 | [精确包元数据](https://registry.npmjs.org/%40humanfs%2Ftypes/0.15.0)声明 Apache-2.0，author 为 Nicholas C. Zakas；gitHead 为 `85069f193cbacc371c3beb649ce746f8c5a493be`。                                                                                              | 精确 types README 与分发包一致，声明 Apache 2.0；精确 types 目录未发现独立 LICENSE／NOTICE。根 [Apache 正文](../../LICENSES/Apache-2.0.txt)是标准条款参考，不以兄弟包版权文件代替 types 原件。 |

其他依赖保留各自许可证／版权／NOTICE，包括实际使用的生成器、Go、Node、PostgreSQL、Debian 与镜像材料；不能整体改称 MIT。[Go 官方许可](https://go.dev/LICENSE)为对应工具链的公开条款入口。实际发行前仍需按锁定版本和真实打包内容汇总完整条款与归属；本摘要不消除这项缺口。

## 2026-10-09 当前依赖与随附材料

旧五项补查是历史证据；是否仍依赖必须以当前锁文件为准。当前不再使用 PostgreSQL、sqlc、OpenAPI 生成器。项目三个 package.json 仍为 private，license 指向根范围说明，路径在 monorepo 内有效，本次无需更改为 SPDX MIT；若未来单包发布，必须把所指文件真正放进包内并重新核对路径。

| 当前运行内容                            | 版本与条款                                                              | 随附证据                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| modernc.org/sqlite                      | v1.34.5，BSD-3-Clause                                                   | 原 LICENSE，The Sqlite Authors；不能把 Go 驱动整体称为公有领域                         |
| modernc.org/libc                        | v1.55.3，BSD-3-Clause，含 Go、musl 等材料                               | LICENSE、LICENSE-GO、COPYRIGHT-MUSL、netdb/LICENSE 原样保留，musl 文件还说明子部分来源 |
| modernc.org/mathutil、memory            | v1.6.0、v1.8.0，BSD-3-Clause 及文件内其他归属                           | 包含 mersenne/LICENSE、LICENSE-GO、LICENSE-MMAP-GO                                     |
| go-humanize、google/uuid、bigfft、x/sys | v1.0.1、v1.6.0、v0.0.0-20230129092748-24d4a6f8daec、v0.22.0，BSD 类条款 | 各模块原 LICENSE，具体条件以原文为准                                                   |
| go-isatty、go-strftime                  | v0.0.20、v0.1.9，MIT                                                    | 各模块原 LICENSE                                                                       |
| Go 标准库/运行时                        | go1.26.8，BSD-3-Clause                                                  | 精确本地工具链 LICENSE；不把全工具链内部所有第三方材料一概归入此条款                   |
| React、React DOM、scheduler             | 19.2.8、19.2.8、0.27.0，MIT                                             | 已安装精确包 LICENSE，Meta Platforms, Inc. and affiliates                              |
| Vite modulepreload helper               | 8.2.2，MIT，包许可另含 bundled notices                                  | 原 LICENSE.md 副本；当前 Web bundle 含 helper，不能只当开发依赖排除                    |

原文共 21 份位于 `LICENSES/runtime/`，逐文件 SHA-256、版本和来源路径见 [运行材料清单](runtime-materials.json)。10 个 Go 模块下载 zip 的 Go h1 内容摘要与 go.sum 一致。首次标准 `go mod verify` 因缺少传递版本的 .mod 且网络解析失败未完成；第二轮获准联网重试已输出 `all modules verified`。SQLite 官方的 [公有领域说明](https://sqlite.org/copyright.html)仅解释 SQLite 自身，不替代上述驱动链条款。

[npm 安装盘点](npm-inventory.json)匹配当前多文档 pnpm 锁文件：193 个条目中 154 个有本地 package.json，全部含许可声明；39 个未安装，含包管理器与其他平台可选包，尚未核查内容。清单中的声明不是完整正文或真实性证明。本机依赖可能残留历史包，因此只取与当前锁文件相交部分。`uri-js-replace@1.0.1` 已不在当前清单；不删除其历史取证。

当前未有独立许可文件的包为 keyv、@humanfs/types、natural-compare、esrecurse、imurmurhash 和当前平台 @rolldown/binding。前四项继续适用上文补查证据；imurmurhash 的条款内嵌与 @rolldown/binding 的分发归属仍须补查，不能因 package.json 有声明即判定材料齐全。它们未据此被认定进入当前 Web bundle；若发布工具链、依赖缓存或其他平台产物，需按实际内容复核。

本次随附目录补上已取得的运行条款，尚非完整镜像 SBOM。Debian 最终层、CA bundle、构建工具生成/注入内容及目标平台文件级归属须在正式候选上收口。现有本机二进制与 Docker 配方的证据差异见 [当前复核](current-v1-review.md)。

第二轮已构建并检查 linux/arm64 隔离候选：88 个 Debian 包的版权文件齐全，CA 的精确源码及通知已核实，配方补复制 CA copyright。详见 [容器分发核查](container-distribution.md)。系统源包完整源码集和未来分发渠道仍待落实，不等同要求整个应用采用 GPL。
