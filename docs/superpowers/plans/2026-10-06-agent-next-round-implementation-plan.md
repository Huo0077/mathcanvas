# 高中全题型 Agent 与自动 Lean 分期实施计划

> **状态（复核）：** 2026-10-06 H0a 表格层 43 条、H0b1 必修/选择性必修 67 条和 H0b2 选修 A–D 64 条规定性一级要求及 E 类 10 个非穷尽举例已入索引（`8826b63` / `8a8fe3e` / `f5e0e75`），仍全部未分类/无金标，4 类 E 开放范围与高考题型未穷尽；完整 H0 未勾，H1–H4 未开始。旧 `2026-10-04-agent-full-next-phase-implementation-plan.md` 的 N1–N6 是历史阶段，不能抵消本计划任何任务。
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 逐任务先读 [设计规格](../specs/2026-10-06-high-school-auto-lean-design.md)；不得自动委派或跳过人工安全门禁。

**Goal:** 覆盖 2025 高中课程标准与高考题型，桌面端对可形式化目标自动调用可信 Lean，用户能区分实例、辅助引理与原题形式证明；竞赛题另表。

**Architecture:** 完整课程清册驱动可扩展数学 IR 与逐域证明策略；受限桌面 Lean 桥输出与原题绑定的独立证据。失败、无题可证与资源不足都按类型回报，不改默认作图路径。

**Tech Stack:** TypeScript/React/Vitest、Tauri Rust、Lean 4/mathlib、Playwright。

**Spec:** [高中全题型自动 Lean 设计](../specs/2026-10-06-high-school-auto-lean-design.md)。**执行看** [任务进度](../../agent-next-round-progress.md)。

## Global Constraints

- 范围基准：2025 年日常修订版课程标准 + 高考题型；竞赛另表，不从课程分母删难题。任何版本变化更新目录、样本和分母。
- 自动意味着开启后无需逐题点击；**不意味着**自动接受草稿、自动把实例改成证明或默认启动不受信进程。
- 只有题设前提全部核验、原题结论与 Lean 命题绑定、可信后端真核验、产物未过期，原题才可 `formally_proved`。辅助引理单独显示。
- `ClaimEvidenceStatus`、候选图状态、solver 状态、proof job 状态四种词表分别保持互斥；未知、超时、未运行、未支持不能折叠成“失败”。
- 任何真实 provider 的付费请求保留两段式人工确认；离线分数、用户提供的样本、真实调用分开统计。
- 每完成独立区块必须更新 `docs/current-status.md`、`docs/agent-next-round-progress.md`、`docs/project-progress.md`、`docs/feature-catalog.md`、README/门禁中受影响处；复验、单独 commit、推送并核对 SHA。Lean 慢集成独立运行，不藏在并行全库套件里。

## 文件职责与原有调用点

| 文件/模块 | 职责 | 真实接点 |
| --- | --- | --- |
| `docs/taxonomy/high-school-2025-source-index.json`、`high-school-2025.json` 与 `scripts/curriculum/catalog.ts` | 2025 PDF 来源/页码/哈希与可编辑分类目录**分离**；校验缺项/重复/越界/金标；H0a 先登记 43 条表层来源且如实报未就绪 | 来源 PDF 171 页、SHA256 固定；高考标签仍未测 |
| `packages/agent-core/src/obligationIR.ts`、`claimEvidence.ts` | 现有来源追溯及互斥状态；新增跨域 MathClaim 映射端口 | `planCompiler.ts` 的编译候选，`apps/web/src/agent/draftStore.ts` 的报告路径；几何 Worker 契约另测 |
| `packages/agent-core/src/proof/proofGoals.ts`、`lean4Adapter.ts`、`proofArtifact.ts` | 当前十类短目标/一类 Lean 引理；扩为逐域策略/原题前提消解及强制 statement 绑定 | `runLean4ClosedLoop` **只**是显式 Node 测试路径；不在产品运行调用链 |
| `apps/desktop/src-tauri/src/commands/`、`proof/lean4/` | 固定版本 Lean 与受限执行；不从 WebView 接受任意命令 | `lib.rs` 命令表；需先锁 mathlib rev（目前 `master`） |
| `apps/web/src/agent/agentRunner.ts`、`featureFlags.ts`、`apps/web/src/components/agent/` | 草稿可预览后的后台 job、失效与状态显示 | `agentRunner.ts` 的 `awaiting_confirmation` / `confirm`；`ConfirmationPanel` 当前只展示泛化说明 |
| `apps/web/src/agent/fixtures/benchmarkPlanningEval.ts`、`packages/agent-core/src/benchmark/report.ts` | 题型、真实评测与费用证据，不能混作证明 | 21 条只跑前 3 条；`cost` 当前 `null` |
| `packages/geometry-kernel/src/`、`apps/web/src/constrainedDrag3.ts` | N2/N3 判据/见证与拖动边界，不承担证明后端职责 | 空间线 `coincident` 目前只安全拒绝，不是已求解 |

## H0：课程清册与审查旧问题（先做，不开证明）

**接口（H0a 实际落地）**：`SourceUnit { unitId, track, category?, sourceSection, pdfPage }`；`CurriculumUnit extends SourceUnit { subtypes: { subtypeId, taskKind, goldCaseIds }[] }`；`SourceSubtype { subtypeId, unitId, sourceSection, pdfPage, title, optionalForExam? }` 在独立来源索引里；`CurriculumSubtype.taskKind` 含 `unclassified`；`auditCoverage(official, editable, cases, expectedSubtypes?)` 返回 `missingUnits/missingSubtypes/missingExamples/openEndedUnits/unclassified/missingCases/duplicateIds/outOfScope/invalidSources/nonPropositional/ready`。`ready` 仅表示目录样本可审计，**不是** Lean 证明或模型质量。完整章节 ID 从标准逐条录入，不以本表十个域名替代。

- [x] **RED（H0a 基础规则）** 新建 `scripts/curriculum/catalog.test.ts`：缺一个标准条目、重复 ID、错分竞赛/课程、无真值的子类型分别报错；断言 `auditCoverage(official, editable, cases).missingUnits` 点名遗漏并验证 `.ready=false` 前用故意缺项数据证明测试会红。命令：`npm.cmd exec vitest run -- scripts/curriculum/catalog.test.ts --reporter=dot`。
> **H0a 中间记录（不勾 H0 GREEN）**：PDF 171 页和 SHA256 已记；独立来源/可编辑索引登记 43 条表层来源（必修 14、选择性必修 8、选修 21），目录审计 `ready=false`；行为断言先后 6 红、3 红，定向 9/9 绿；篡改源 SHA 1 红/8 绿、恢复 9/9。**H0b1 补必修/选择性必修 67 条（选学 5）；H0b2 补选修 A–D 64 条规定性一级要求与 E 类 10 个“例如”举例；全部 `unclassified`/无金标，E 地方/学校课程仍是开放域，高考标签仍缺。不能以 43 条标题或 131 条一级要求宣称 H0 完成。**

- [ ] **GREEN** 创建版本化目录、来源索引、机器校验和跨章标签；新增高考样本的出题年与去重规则，公开版权只留题目元数据/短摘要（原题文本合法来源单列）。每子类型至少正例/反例/歧义，标记 `not_measured` 而不是虚构通过。
- [ ] **审查台账**逐项确认此前审查 ① N1/N2 状态三词表、IR 调用点、feature flag；② N3 测试路径/负例/安全拒绝；③ N4 Vitest 与 CI、真实 provider 数据/成本；④ N5 许可证/线程/WASM/版本固定；⑤ 文档分类/日期/换行/BOM。已有证据标已解决但保留残余，缺证据列下一项。
- [ ] **门禁、同步与推送**：本阶段仅数据/规则，不改变产品；`npm.cmd run typecheck`、定向单测、文档一致性、`git diff --check`，再更新所有权威文档并核对远端 SHA。

## H1：原题命题与前提的可信翻译（N5 不能跳过）

**接口**：`formalizeClaim(claim: MathClaim, catalogId: string): FormalizationResult`；`dischargePremises(result, facts): { proven, unresolved }`；`proofInputHash` 必须包含原题目标、全部前提、source span、翻译版本与所生成的 Lean statement。现有 `ClaimEvidenceStatus` 不增 `unverified_instance`；候选图状态继续独立。

- [ ] **RED** 在 `packages/agent-core/src/proof/formalization.test.ts` 写：删除一个题设、把目标 AB⊥CD 换成 AB∥CD、模板凭空添加 `hv`、只证明辅助引理、第四个平面点被忽略，均**不得**把原题升级到 `formally_proved`；反向真例须保留旧的 `verified_instance`，证明断言确实有咬合力。命令：`npm.cmd exec vitest run -- packages/agent-core/src/proof/formalization.test.ts --reporter=dot`，先记录正确的 RED（环境错误不算）。
- [ ] **GREEN** 扩展跨域 MathClaim 的表达式/量词/自由变量/单位/定义域及来源区间；新增独立的前提消解与 Lean 命题审核；允许 `lemma_proved` 但原题未证的组合，输入变更失效。不得把示例坐标当普遍证明。
- [ ] **门禁、文档、提交推送**：同块覆盖 Worker、`draftStore.ts`、`planCompiler.ts` 的 IR 往返与状态互斥；运行 `npm.cmd run proof:smoke`，更新进度/风险，推送核对。

## H2：受限 Lean 桌面运行与自动调度

**接口**：`ProofJob { runId, claimId, documentFingerprint, inputHash, strategyId, toolchainRevision, deadlineMs }`；`ProofRunner.run(job, signal): Promise<ProofOutcome>`；proof job 状态与 ClaimEvidence 分开。具体命令名在 H2 RED 测试先固定，Rust 和 Web 不各造一套。

- [ ] **RED** `apps/desktop/src-tauri/src/commands/proof.rs` 的 Rust 单测：不受信路径/任意命令、资源超限、超时、取消、缺 Lean、版本不符、`sorry`/非法 axioms、临时文件清理；Web `apps/web/src/agent/automaticProof.test.ts`：草稿可预览启动、关 flag 完全不调用、相同 claim 去重、切换会话/修改草稿后旧结果失效、停止和迟到回包不可冒充证明。分别用 `npm.cmd exec vitest run -- apps/web/src/agent/automaticProof.test.ts --reporter=dot` 和 `npm.cmd run test:rust` 先记录功能断言失败。
- [ ] **GREEN** 锁 `proof/lean4/lakefile.toml` 的 mathlib 精确 revision 与工具链指纹；完成许可证/体量/平台/线程/WASM/离线分发审查；Tauri 固定执行桥（不拼 shell，不接受任意 Lean 代码），WebView 注入受限端口；运行时负载/并发边界与用户说明。**安全审查没过则只在实验开关后运行，不能默认开放。**
- [ ] **浏览器与桌面反例** Playwright 真路径涵盖开关关/开、无 Lean、超时与证据失效；独立真 Lean 烟测核对产物、内核 axioms，避免并行全库套件的 300 秒超时误读。没有真实桌面验收不能声称桌面产品已自动证明。
- [ ] **文档、提交推送**：typecheck/lint/build/定向/Vitest/CI/e2e 分开记录，进度与门禁同步后推送核对 SHA。

## H3：全课程证明包与领域覆盖（不是仅几何）

**插件契约**：`DomainProofPack { catalogSubtypes, formalize, trustedStrategies, goldPositive, goldNegative, unsupportedReason }`。每个下面的子块独立 RED→GREEN→文档→commit→push；每子类型入题集且题目不能随实现改写为模板喜欢的形状。先 H1/H2 后上线，H0 的课程章节索引是分母。

- [ ] **H3a 代数、集合/逻辑、函数、不等式**：定义域、等价变形、存在/全称量词、参数分类与反例；不得以采样替恒等式证明。
- [ ] **H3b 数列、归纳、计数**：递推基例与归纳步、组合计数/离散边界；无归纳假设的结论不得升档。
- [ ] **H3c 三角函数与向量**：周期/定义域/恒等式、平面和空间向量；漏掉分母为零或取值范围的用例必红。
- [ ] **H3d 平面、立体、解析几何**：共线、共面、距离、位置关系、圆锥曲线等；当前 `perpendicular` 引理不得单独把本域标完成。自由点允许直觉见证图，但图不等于原题证明。
- [ ] **H3e 导数及应用**：连续/可导前提、单调与极值、参数；错误定义域和端点反例。
- [ ] **H3f 概率、统计与数据分析**：样本空间和条件概率前提、参数估计/统计推断边界；对开放建模输出 `non_propositional`，可核查子主张单列。
- [ ] **H3g 2025 课程选修专题和高考跨域综合**：依官方章节与标注题型逐一增补；单域包组合要显式证明衔接，不能靠自然语言总结伪造结论。
- [ ] **每块共用门禁**：新增原题金标来源、至少三条不同结构正例和负例/歧义/退化，定向真 Lean + 假 runner 断言、跨 Worker 契约、浏览器端证据 UI；更新矩阵分子/分母、进度文档并推送。**这些清单只是领域分组，实际子类型数量必须由 H0 标准清册逐条展开，不许少报。**

## H4：审查旧限制、评测、发布与人工验收

- [ ] **N2/N3**：见证搜索扩棱柱撇点名与四边形非环首等现存盲点，所有候选过原题核验；拖动其它无空间判据的条件逐类 fail-closed 或实现空间判据；补齐文档层真实自由度，不能只靠保留 `degreesOfFreedom=null` 把此项打勾（若暂时算不了须记录阻断、仍留未完成）。审查模块环和 `inconsistent`/`timeout` 差别。每一独立修复有 RED 正反例与推送。
- [ ] **N4/质量**：21 条题集与课程题型清册对齐；真实 provider 指标逐层（抽取、规划、见证、题设覆盖、证明、可读性）；`cost=null` 必须带原因，价格版本与 token usage 可追溯；>1 MiB 响应单列测不到，不挤进拒绝率。付费运行须单独获用户确认，不自行发请求。
- [ ] **发布**：完成教师/学生走查；管理员权限 MSI 安装→启动→卸载独立于 NSIS；doc/CI/测试稳定性、许可/安全、真实桌面打包与 proof toolchain 安装审查。release gate 明示“未覆盖子类型数”，除零之外不宣称所有题型均支持或发布默认自动证明。
- [ ] **复核全量要求**：逐条运行所涉 workspace typecheck、lint、非 Lean 全库、独立 Lean、全量 e2e、Rust、build 与许可证审查；记录退出码/环境限制。每区块更新统一进度、提交推送核对 `git ls-remote`。最后按课程章节/高考标签逐项签收，不拿“所有测试绿”替代结果正确。

## 可直接落地的 RED 断言形状（各任务先建导出骨架，再运行测试，编译/环境错误不算 RED）

H0：`scripts/curriculum/catalog.test.ts` 从两条已登记标准条目中只给一条样本，先断言缺口被点名而**不是**静默返回空数组；实现前要看到断言失败，再补校验器：

```ts
import { expect, it } from "vitest"
import { auditCoverage } from "./catalog"

it("names a curriculum subtype with no gold case", () => {
  const units = [{ version: "2017-2025", unitId: "sample-unit", sourceSection: "sample-section", subtypeId: "with-case", taskKind: "proposition", goldCaseIds: ["case-1"] },
    { version: "2017-2025", unitId: "sample-unit", sourceSection: "sample-section", subtypeId: "missing-case", taskKind: "proposition", goldCaseIds: [] }]
  expect(auditCoverage(units, [{ caseId: "case-1", subtypeId: "with-case" }]).missing).toContain("missing-case")
})
```

H1：先由一个已知条件引理的产物驱动 `ProofOutcome`，把未消解 `hv` 留在输入，验证**原题**仍未证明；删掉这个门禁时断言必须红：

```ts
expect(outcome.unresolvedPremises).toContain("hv")
expect(outcome.claimEvidence.status).not.toBe("formally_proved")
expect(outcome.artifact?.claimId).not.toBe(originalClaimId)
```

H2：通过注入的 `ProofRunner` 统计调用，缺省关旗时零次、显式打开后草稿可预览时一次，同一 `inputHash` 去重；把文档 revision 改掉后旧结果不能覆盖当前证据（测试 `scheduleProof` / `invalidateProof` 实际注入点，不直接调用演示私函数）：

```ts
expect(runnerCalls).toHaveLength(0) // flag 关闭
// 开旗并发布一份可预览草稿后
expect(runnerCalls).toHaveLength(1)
// 草稿改变后再投递第一个 job 的晚到结果
expect(currentEvidence.status).not.toBe("formally_proved")
```

H3 逐域复制 H1 的“双向证据”：替换题设的一处定义域/边界/数量/图形条件后必须拒绝旧证书；真题保持原文不变，`sorry` 和额外假设都不允许把金标归入“该类已证明”。H4 的 `BenchmarkRun` 需同时对 `cost: null` 与 `cost: { amount, currency }` 做来源/价目表版本断言，未授权付费运行绝不作为自动 RED 命令。

## 本次规划与实施边界

本文件是下一阶段**未执行**的实施清单，不是代码完成报告。H0 及 H3 每个章节展开之前须再用原始课程文本逐条核准样本和分母；H2 的默认启用须明确许可与安装实测；用户没有授权任何新的付费 provider 请求。该计划不改写旧 N1–N6 的历史提交，也不把旧复选框重新解释为新目标完成。
