# LobeHub acceptance 公开规则本地兼容

Status: ready-for-agent

## Problem Statement

本地 acceptance 已经能够保存 Round、登记 catalog、渲染多轮交付并写入人审 overlay，但它只读取 JSON，没有执行 LobeHub acceptance 已公开的结构、证据、门禁、归一化和跨轮规则。因此，一个能在本地页面打开的 Round 不一定能通过官方 ingest，也无法可靠区分可人审、证据不足和结构损坏。

用户需要先让本地工作流兼容当前 LobeHub acceptance v0.1.0 的公开、确定、可离线观察的规则，再单独发展本地 renderer、catalog 和离线工作流。兼容目标不包含 Cloud 黑盒行为，也不能通过修改原始 Round 来伪造通过。

## Solution

新增一套无 Cloud 依赖的共享 Round validator。CLI 和本地读取链路调用同一实现，把磁盘上的 Raw Round 转换成只读 Derived Model，并给出 `ready`、`held` 或 `rejected` 结果及稳定诊断。

validator 按公开规则执行结构校验、门禁剔除、默认值归一化、证据覆盖检查、结构化可视化校验和跨轮谱系检查。封存时为 Published Round 记录内容摘要、规则版本和稳定序号；后续修改会被识别，而 `reviews.json` 继续作为独立可变的人审 overlay。

现有 catalog、127.0.0.1 页面和本地 review 机制继续作为外壳。非法、held 和 legacy Round 保持可见，但不能绕过 validator 进入正常验收历史。

## User Stories

1. As a builder, I want to validate a single Round locally, so that I know whether its public contract is valid before handoff.
2. As a builder, I want CLI and renderer validation to use the same rules, so that local results do not have two sources of truth.
3. As a builder, I want validation to leave Raw Round files unchanged, so that evidence history remains honest.
4. As a builder, I want a Draft Round to remain editable before sealing, so that authoring mistakes do not create meaningless history entries.
5. As a reviewer, I want Published Rounds to detect later content changes, so that an earlier decision cannot silently point at different evidence.
6. As a reviewer, I want machine status and evidence sufficiency kept separate, so that a `pass` without required evidence is shown as uncertain rather than rewritten.
7. As a reviewer, I want invalid Rounds isolated instead of crashing the whole subject page, so that valid history stays available.
8. As a reviewer, I want held Rounds visible but not acceptable, so that missing evidence cannot be overridden by a click.
9. As a reviewer, I want to reject a held item, so that I can record why the delivery is insufficient.
10. As a reviewer, I want dropped test, lint, typecheck, build and CI checks listed in diagnostics, so that hidden input remains auditable without polluting acceptance checks.
11. As a builder, I want a gates-only Round rejected, so that an acceptance contains something a person can judge.
12. As a builder, I want missing planned cases rendered as not run, so that reduced coverage remains visible.
13. As a builder, I want every required evidence type checked independently, so that one artifact cannot satisfy unrelated requirements.
14. As a reviewer, I want before and after pairs validated, so that incomplete comparisons are not presented as proof.
15. As a reviewer, I want nested evidence paths served safely, so that official `assets/**` layouts work without traversal or symlink escapes.
16. As a repository owner, I want obvious credential exports, HAR files and unredacted textual secrets rejected, so that local evidence does not retain sensitive data.
17. As a reviewer, I want all six public structured visualization types validated before rendering, so that charts cannot silently reference missing or invalid data.
18. As a builder, I want summary counts checked against cases, so that the report cannot claim numbers contradicted by its own data.
19. As a builder, I want public defaults applied only to the Derived Model, so that compatibility does not rewrite the source report.
20. As a maintainer, I want unknown object fields preserved in Raw Round and ignored with a warning, so that future extensions do not execute accidentally.
21. As a maintainer, I want closed-vocabulary values rejected, so that misspelled statuses and surfaces cannot become new semantics.
22. As a reviewer, I want stable check IDs and supersedes lineage validated across rounds, so that replacement history is unambiguous.
23. As a reviewer, I want accepted checks re-run as new unreviewed results, so that prior approval is never inherited by fresh evidence.
24. As a reviewer, I want unresolved rejects to keep the subject held, so that a later Round cannot make rejected work disappear.
25. As a maintainer, I want each Published Round bound to its original ruleset, so that upgrading the validator does not rewrite historical outcomes.
26. As a maintainer, I want missing historical rulesets reported rather than substituted, so that old receipts remain meaningful.
27. As a maintainer, I want batch sealing to be transactional, so that one invalid Round cannot leave half a subject migrated.
28. As an automation author, I want stable JSON diagnostics and exit codes, so that tooling can distinguish ready, held, rejected and operational errors.
29. As a local user, I want legacy Rounds and pre-seal reviews retained but marked stale, so that migration does not erase history or grant unverified approval.
30. As a local user, I want catalog and renderer behavior preserved, so that compatibility work does not require Cloud services.
31. As a maintainer, I want optional interaction traces handled according to the public rules, so that missing or unpriceable traces do not invent cost data.
32. As a maintainer, I want a trace with a precomputed interaction cost preserved, so that validation does not overwrite producer-owned results.
33. As a maintainer, I want semantic evidence advice reported only as advisory, so that heuristics do not pretend to be mechanical proof.
34. As a maintainer, I want every public rule mapped to a test or an explicit black-box exclusion, so that “complete compatibility” has a measurable boundary.

## Implementation Decisions

- The compatibility target is the current public acceptance v0.1.0 skill and its public references. Undocumented Cloud behavior is recorded as a compatibility gap, not guessed.
- The first ruleset is named and versioned. A ruleset referenced by a receipt must remain available indefinitely.
- The validation seam is one shared validator consumed by the CLI and the Round loading boundary. The renderer consumes only its Derived Model.
- A Draft Round is mutable until explicit sealing. A Published Round is immutable within the application contract.
- A Raw Round contains `result.json`, `report.md`, `assets/**`, and optional `interaction-trace.jsonl`. Review overlay, receipt metadata and catalog entries are outside Raw Round.
- Validation outcomes are `ready`, `held` and `rejected`. Review state remains a separate dimension.
- Diagnostics contain a stable code, source, effect, path, message, rule version and optional safe details. Diagnostic effects are `reject`, `hold`, `drop`, `normalize` and `advisory`.
- Diagnostic sources distinguish public rules, compatibility assumptions and local safety checks.
- Validation aggregates all deterministic problems. Internal errors may fail immediately.
- Public hard failures reject sealing. Public evidence gaps hold a Round. Public defaults affect only the Derived Model.
- Tests, test suites, coverage, typecheck, lint, format, build, compile and CI checks are removed from the Derived Model with warnings. Summary is recalculated after removal. A gates-only Round is rejected.
- Gate recognition is deterministic, versioned and fixture-backed. It scans title, category and method, supports equivalent Chinese and English expressions, and does not use an LLM.
- Raw summary counters must equal case statuses. Total counts cases. Planned items without cases are derived as not run and require a partial verdict.
- A failed case requires a failed verdict. Blocked or not-run work requires a partial verdict. Pass is valid only when every remaining plan item has a passing case.
- Missing Round title or summary verdict follows the public degraded behavior and holds the Round. Other required structural fields fail closed.
- Missing verifier normalizes to agent. Missing evidence, required-evidence and supersedes arrays normalize to empty arrays.
- Plan and case IDs are non-empty and unique within a Round. Every case references a plan; a plan may have no case.
- Unknown object fields stay in Raw Round, are excluded from the Derived Model and produce compatibility warnings. Unknown values in closed vocabularies are rejected.
- Case category must match its plan. Case name may describe the concrete execution and need not equal the plan title.
- Surfaces match the actual case surface set after normalizing electron to desktop.
- Supersedes references only earlier IDs in the same subject, cannot self-reference or fork one old ID into multiple active successors, and repeats the full ancestor set on later reuse.
- Reusing an ID with changed descriptive fields produces a warning because semantic equivalence cannot be decided mechanically.
- Review belongs to one exact Round and check ID. It never transfers to a later case.
- A repeated accepted ID becomes unreviewed. A latest reject remains held until the same ID is retested or a valid successor appears.
- A damaged review overlay does not reject Raw Round. It makes review state untrusted, holds the subject and blocks further review writes until repaired.
- Pre-seal reviews are retained for display but marked stale and do not count toward current acceptance.
- A missing review overlay means no review.
- Required evidence uses a versioned conservative extension map. Unknown mappings cannot satisfy a requirement.
- Every required evidence type needs a distinct valid artifact. Duplicate references do not increase coverage. Pass and fail cases need evidence; blocked cases may omit it.
- Nested assets are supported. Absolute paths, traversal, null bytes, missing files, non-regular files and symlinks are rejected.
- HAR and environment files within a Round are rejected. Referenced textual evidence is scanned for obvious unredacted credential values without echoing those values.
- Unreferenced ordinary assets produce warnings. Every asset is still included in the immutable digest.
- Comparison groups are local to a case and contain exactly one before and one after. Missing layout normalizes to horizontal.
- Dataset and visualization structure follows the six public version-1 renderers. Invalid references, encodings, field types or row shapes reject the Round. Total inline rows cannot exceed 10,000.
- Structured visualizations do not replace audit evidence.
- Evidence quality rules that require understanding content remain advisory unless the plan explicitly requires the relevant evidence type.
- The optional interaction trace is part of the Raw Round digest. Missing traces are silent. Unknown records are unpriced. Blocked actions count as zero. Existing interaction cost data is preserved. Undocumented price constants are not invented.
- Round directories use timestamp-slug names. Created-at values require an explicit ISO timezone. Receipt sequence, not file timestamp, defines published order.
- Receipts live in local metadata outside Raw Round and record SHA-256, ruleset, sequence and sealing time. Hashing includes sorted relative paths and bytes for all Raw Round files.
- Reviews and receipt metadata are excluded from the Raw Round digest.
- Re-sealing an unchanged Round is idempotent. A changed digest is reported as tampering and cannot be forced or overwritten.
- Receipt writes use temporary files and atomic rename. Subject sequence allocation uses a short local lock.
- Integrity protects against accidental modification, not an attacker who can rewrite both Raw Round and metadata.
- The CLI accepts an explicit Round, subject or acceptance-root path and supports human and JSON output plus optional sealing.
- Batch sealing validates every target first and writes no receipt when any target is rejected.
- Ready returns exit code zero. Held or rejected returns one. Invocation, I/O or internal failures return two.
- The renderer keeps rejected and legacy Rounds visible in diagnostics but excludes them from union, summary and review.
- Held Rounds render normally but cannot be accepted. Dropped checks render only in diagnostics.
- A subject with no union-eligible Round still renders its diagnostics instead of returning a blank page or not found response.
- The local catalog remains a path registry and does not become a validation store.
- No new runtime validation dependency is added. The implementation uses Node standard-library facilities and narrow project-specific predicates rather than a generic validation framework.

## Testing Decisions

- The highest shared test seam is the validator result: the CLI and loading boundary must return the same outcome and diagnostics for identical input.
- Tests assert external behavior, stable diagnostic codes, sources, effects and paths. They do not lock human wording or private helper structure.
- Each mechanical public rule has at least one valid fixture and one invalid fixture.
- Gate fixtures include positive and negative Chinese and English examples to prevent both missed gates and false removal of user-visible behaviors.
- Filesystem tests cover nested assets, traversal, absolute paths, symlinks, missing files, HAR, environment files, credential redaction and unreferenced assets.
- Evidence tests cover every required type, zero-byte files, duplicate references, wrong types, missing types and comparison pairs.
- Schema tests cover required fields, defaults, closed vocabularies, unknown fields, ID uniqueness, orphan cases, category and surface consistency, and summary conflicts.
- Visualization tests cover every renderer, field references, encodings, enum values, duplicate IDs and the 10,000-row boundary.
- History tests cover stable IDs, valid and invalid supersedes, forks, cycles, accepted re-runs, unresolved rejects, stale reviews and ruleset availability.
- Receipt tests cover deterministic hashing, excluded overlay files, interaction traces, idempotent sealing, changed content, atomic batch behavior and stable sequence.
- Renderer tests use fixtures for ready, held, rejected, dropped and legacy states. Invalid history remains visible without entering the union.
- Existing delivery tests remain prior art for union, snapshot, review and loopback behavior; their fixtures are upgraded to valid Round contracts.
- The project quality gate runs lint, typecheck, Node tests and production build.
- A real local browser smoke test verifies the five renderer states without contacting Cloud or ingesting a Round.

## Out of Scope

- LobeHub Cloud, database storage, authentication, remote acceptance pages and uploads.
- Operation IDs, check-result IDs, per-artifact submit commands and Cloud session discovery.
- Exact equivalence with undocumented gate regexes, coercion, MIME sniffing, upload limits, stale-review logic or error precedence.
- Reimplementation of unpublished interaction-cost pricing constants.
- Semantic inspection of screenshots, audio, video or prose with OCR, media analysis or an LLM.
- Adversarial protection against a user who can rewrite both a Round and its local receipt.
- Automatic migration, sealing or approval of existing legacy Rounds.
- Automatic deletion of dead catalog roots.
- Ingest, Git commits or writes to existing evidence during implementation.

## Further Notes

- The current catalog has three live roots containing seven legacy Rounds. Three legacy Rounds have review overlays. They will receive a read-only audit after implementation.
- Legacy reviews remain visible but stale until their Round is explicitly sealed and reviewed again.
- Current public documents do not expose a complete evidence-extension map or Cloud gate matcher. Non-audio mappings and deterministic matching behavior are identified as compatibility assumptions.
- The compatibility rule matrix is the completion ledger. Every public rule must be implemented, advisory, or explicitly marked as black-box excluded.
