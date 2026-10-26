# 按内容区分许可

记录日期：2026-10-09。入口：[LICENSE](LICENSE)。用户已授权“按照你的推荐先根据内容区分协议”；后续用户明确确认：排除已标注 LobeHub 参考内容后，新 V1 全部由其自行开发，没有第三方权利限制。

## 范围规则

下表的具体文件行优先于目录行，目录行优先于“其余内容”行。范围是内容范围而非目录内所有字节的统一授权；混合文件内上游表达及其改写保留上游条款，本地新增表达没有自动取得 MIT。当前 [MIT 生效清单](docs/licensing/mit-scope.json) 的具体文件及 SHA-256 优先于下表泛化描述；清单外不自动授权。目录名称不代表未来新增文件或历史版本均受 MIT 覆盖。

2026-10-09 迁移收尾后，下表涉及 `.agents/skills/acceptance-cl/`、旧 `server/`、根目录 `web/`、`test/`、`scripts/dev.js`、旧规则文档／ADR、`README.legacy.md`、`bun.lock` 及根 Vite/TS 配置的条目仅记录已移除内容的历史许可和来源边界，不表示这些路径仍在当前工作树或 V1 分发范围内。移除前的文件可从 Git 提交 `2f90c210a74d4dd9bf8dde7ebe992bca5fa157c0` 查看；保留本记录不对历史内容重新授权。

| 范围                                                                                                                                              | 内容与证据                                                                                                                              | 当前许可处置／待核实事项                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.agents/skills/acceptance-cl/SKILL.md`、`references/round.md`                                                                                    | 模板、中文工作流及 Round 文档有沿用／压缩改写；`new_round` 仅改变量名。来源为 LobeHub acceptance 的 SKILL/report/evidence/plan-format。 | 上游表达及改写保留 Community License + Apache 正文、LobeHub LLC 版权和修改说明。本地适配／Receipt 等新增表达权属待核实。9月3日读取的部署 bundle 身份仍待核实，不能断言仅有该固定提交。 |
| `server/validation-rules-v0.1.0.js`、`server/validation.js`、`server/validation-visualizations.js`                                                | 封闭词表、trace schema、门禁剔除、六类可视化协议与字段约束有定位来源，AI 参考后改写为本地诊断逻辑。                                     | 有来源的规则／协议表达及改写保留上游条款。Diagnostic、本地安全边界等新增内容没有单独确权，不把整文件改标 MIT；未声称整函数逐字复制。                                                   |
| `docs/acceptance-validator-rules.md`、`docs/adr/0001-public-acceptance-validator.md`                                                              | 记录上述公开规则、兼容假设和本地取舍的混合文档。                                                                                        | 上游规则表达及改写保留上游条款；本地编排／决策表达待核实。ADR 是旧工具行为决定，不是 MIT 重许可依据。                                                                                  |
| `server/delivery.js`、`server/validation-history.js`                                                                                              | 稳定 ID 聚合与 supersedes 规则参考上游 acceptanceService/report；执行结构不同。                                                         | 已标来源、修改与上游条款；规则表达的衍生边界及本地算法实现权属仍待核实，不把整文件认定为独立原创或统一 MIT。                                                                           |
| `web/Visualizations.tsx`、`web/types.ts`、`web/Evidence.tsx`、`web/DeliveryPage.tsx`                                                              | 六类视图、encoding/comparison 与信息架构有对应；数学缩放和求域存在短段相同写法，整体组件实现不同。                                      | renderer 待核实：相同数学公式不单独证明复制，不同包装也不证明原创。保留来源与适用的上游条款材料，不对整组件作 Community License 或 MIT 确权声明。                                      |
| `web/` 其余文件；`server/` 其余文件；`bin/`、`scripts/dev.js`、`test/`；旧 `index.html`、`vite.config.ts`、`tsconfig.json`、`bun.lock`            | 已移除的旧 renderer／本地外壳、工具、测试及配置；未恢复最早生成来源，未逐项完成来源复核。                                               | 待核实；无新增 MIT 授权。上游条款与其他第三方许可按实际内容适用，不能从 Git 作者推断全部权属。                                                                                         |
| `.agents/skills/acceptance-cl/scripts/acceptances-cli.mjs`、`agents/openai.yaml`                                                                  | CLI 解析器有本地新增会话线索，未定位对应上游解析器；配置未独立确权。                                                                    | 待核实／原创候选，不因位于同一 skill 目录而认定统一 Community License，也不自动 MIT。                                                                                                  |
| 当前新 V1 的 `cmd/`、`internal/`、`apps/web/`、`packages/api-client/`、`skills/Acceptances-Cl/`、`scripts/v1/`、`deploy/` 及清单中的入口配置/文档 | 已按当前重构内容核查，并获权利人明确确认；精确文件与哈希见 [MIT 清单](docs/licensing/mit-scope.json)                                    | `MIT-confirmed`，适用 [标准 MIT](LICENSES/MIT.txt)，Copyright (c) 2026 acceptances。不覆盖依赖、第三方表达、未列明文件或历史版本。                                                     |
| `packages/api-client/src/schema.d.ts`                                                                                                             | 已移除的历史生成文件；曾由 openapi-typescript 7.13.0 根据 `contracts/openapi.yaml` 生成，输入协议也已移除。                             | 仅保留历史归属，非当前生成产物；生成内容仍待核实，历史输入权属和可能模板表达分别核查。生成器采用 MIT 不证明其全部输出可由用户按 MIT 授权。                                             |
| 当前 README.md、GLOSSARY.md、V1 接入/工具链/实现交接、当前 ADR、contracts/README.md 与 db/README.md                                               | 具体以 MIT 清单所列当前文件为准                                                                                                         | 清单内当前项目原创表达采用 MIT；旧 README.legacy.md、历史规划、第三方引用与 `.scratch/` 不在该授权范围。                                                                               |
| `package.json`、`apps/web/package.json`、`packages/api-client/package.json`；`pnpm-lock.yaml`；已移除的 `bun.lock`                                | 项目包元数据／依赖身份记录。                                                                                                            | 项目包 `license` 指向范围说明，`private: true` 保留，不声明统一 MIT。锁文件中的第三方 MIT 等声明只描述对应依赖。                                                                       |
| `LICENSES/LobeHub-Community-1c7a711.txt`、`LICENSES/Apache-2.0.txt`                                                                               | 固定提交的上游许可原文与官方 Apache 正文。                                                                                              | 原样保留，出处与 SHA-256 见 [材料清单](docs/licensing/upstream-materials.json)；不是用户重新授权的项目源码。                                                                           |
| `LICENSE`、本范围表、`NOTICE`、`docs/licensing/`                                                                                                  | 来源事实、上游引用和项目许可安排分别记录                                                                                                | 许可声明按所声明范围生效；本次不将混有第三方材料的整个许可文档目录统一授为 MIT。                                                                                                       |
| 依赖目录、构建产物、容器／运行时及 `.scratch/` 中第三方材料                                                                                       | 依赖许可证多种；Go、SQLite 驱动及依赖、Debian、Node 等不能统一归为 MIT。                                                                | 沿用各自条款、版权／NOTICE；发行候选须确认实际打包内容和随附材料，现有材料归档不是最终发行清单。                                                                                       |
| 其余路径、隐藏配置、未来新增或修改内容                                                                                                            | 包括 `AGENTS.md`、`docs/agents/`、`.gitignore`、`eslint.config.js`；未证实完整权属。                                                    | 默认待核实，无新增许可授权。不能用本表的目录分类为未来引入的第三方内容自动授权。用户数据与凭据不属于本次许可整理／分发范围。                                                           |

## 固定来源与混合文件边界

上游基准：[`lobehub/lobehub@1c7a7116313bcc2d675937139554a244f7adf7a0`](https://github.com/lobehub/lobehub/tree/1c7a7116313bcc2d675937139554a244f7adf7a0)。其根许可确为 Community License，不能替换为其他版本的 MIT 或独立 lobe-ui 包的 MIT。[来源与修改记录](docs/licensing/lobehub-provenance.md)提供固定上游路径、可公开的具体对应及证据限制。正式许可说明和完整上游许可正文保存在仓库根及 docs/licensing；本地内部记录不属于 Git 内容，也不是理解许可范围的必要依赖。

保留 [Community License](LICENSES/LobeHub-Community-1c7a711.txt)和 [Apache-2.0](LICENSES/Apache-2.0.txt)，不是两者任选。Community License 对开发、分发衍生作品的商业许可有附加条件；生产者仍为上游 LobeHub，不是 Acceptances。添加归属、AI 改写或更换实现语言不等于消除许可义务，也不等于上游给予本项目额外授权。公开分发条件尚未确认。

[NOTICE](NOTICE)是本项目编写的归属通知，不冒充上游 NOTICE。固定提交完整目录核查未发现根 NOTICE 或相关 acceptance 路径祖先目录 NOTICE；发现的 `apps/desktop/THIRD_PARTY_NOTICES.md` 不在本轮参考内容内。该结论仅限已确认提交／路径；未固定的部署 bundle 和未来第三方内容仍须补查。

## 原创 MIT 与 A35 子项

用户针对排除已标注 LobeHub 内容后的新 V1，明确确认全部由其自行开发，没有第三方权利限制。结合此前按内容区分许可的选择，已将 [MIT 清单](docs/licensing/mit-scope.json) 中当前原创文件按 [MIT 正文](LICENSES/MIT.txt) 授权。新 V1 权属确认、署名、标准文本和精确范围子项已解决；清单包含当前源码、测试、skill、配置及明确列出的 V1 文档，按哈希固定本次许可范围。

该确认不撤销先前 LobeHub 来源取证，不将旧 renderer、validator、acceptance-cl 或整个 Git 历史重新标成原创。A35 总体仍 blocked：历史混合/renderer 衍生边界、未识别部署 bundle、上游分发条件及最终发行形式/源码材料提供仍未收口。不得仅为关闭工单把这些子项改为通过。

## 本地精简版复核

当前源码、历史删除路径与产物分别见 [2026-10-09 复核](docs/licensing/current-v1-review.md)。`skills/Acceptances-Cl/` 不沿用旧 skill 的整目录许可判定，当前清单中的两份文件已确认为 MIT。`contracts/` 和 `db/` 当前仅有 README。`LICENSES/runtime/` 是第三方原条款副本，按其自身条款处理；来源、版本、摘要见 [运行材料清单](docs/licensing/runtime-materials.json)。`docs/licensing/npm-inventory.json` 是当前锁文件的安装材料盘点，不是项目授权或完整发行许可结论。
