> **路线更新：** 本文是较窄的第一版见证搜索路线，已被 `2026-10-04-agent-full-next-phase-design.md` 与 `2026-10-04-agent-full-next-phase-implementation-plan.md` 扩展为完整阶段路线；保留本文作为 N2/N4 的早期拆解。

# 下一轮 Agent 升级实施计划：见证搜索与真实 Provider 评测

> **For agentic workers:** 这是一份下一轮计划，先评审设计再执行；步骤用 checkbox 跟踪。不要在未批准前改代码。

**Goal:** 在当前题设逐条核验之上，让受支持的欠定立体题由系统稳定生成一组可读见证，并建立真实 provider 的可重复评测基线。

**Architecture:** Obligation IR 统一题设、目标和自由点；WitnessSearch 只生成候选，不自证；现有 `verifyDiagramObligations` 作为唯一验收真源。真实 provider benchmark 独立于 CI，用人工标注区分实例合法性、题设覆盖和图面可读性。

**Tech Stack:** TypeScript、Vitest、Playwright、现有 geometry-kernel、agent-core、JSONL benchmark、Provider API 适配器。

**Spec:** `docs/superpowers/specs/2026-10-04-agent-next-round-witness-search-design.md`。

## Global Constraints

- 静态示意图允许自由点取示例值；不称唯一解、不称普遍证明。
- 视觉可读性只能在数学条件全部通过后排序，不能抵消失败。
- 不支持/歧义/退化必须是显式 unverified/no_witness，禁止空报告成功。
- 不把真实 provider 指标混入 `deterministic_local`。
- 不在本轮引入持久动态约束、通用形式证明或全自然语言求解器。

## Task 1：Obligation IR 单一契约

**Files:** Create `packages/agent-core/src/obligationIR.ts` and tests; modify `diagramObligations.ts`, `contracts.ts`, `index.ts`.

- [ ] 写 RED：同一题面产生 `given/goal/free_choice` 三类；保留 sourceText/start/end；未知句型为 `unsupported`，不能丢失；`AB:AC=2`、`AB=1/2` 不得截断为定长。
- [ ] 实现最小判别联合与稳定 id；现有 `DiagramObligationSet` 提供兼容转换，避免一次改遍所有调用方。
- [ ] GREEN：题设、关系、自由点和现有 relationExtraction 全部定向通过。
- [ ] 复核：模型 `relations` 不是 IR 的来源，只能作为附加线索。

## Task 2：候选失败分类与报告

**Files:** Modify `diagramVerification.ts`, `contracts.ts`, `completionGate.ts`; tests.

- [ ] 写 RED：同一候选分别产生 `failed`（条件不成立）、`unverified`（不支持/退化/缺名）、`no_witness`（候选耗尽）三类，不互相混淆。
- [ ] 保持当前 `VerificationReport` 兼容，在 `next_actions` 中给出原文条件、最大残差和建议。
- [ ] GREEN：Gate、Coordinator、HostBridge 和确认 UI 仍阻止非 verified_instance。
- [ ] 复核：失败报告包含全部未核验条件，不只显示第一条。

## Task 3：确定性 WitnessSearch 核心

**Files:** Create `packages/agent-core/src/witnessSearch.ts` and tests; reuse `@draw/geometry-kernel`.

- [ ] 写 RED：同一 seed 对同一 IR 产生相同候选；候选满足题设才保留；极度拉长、退化、特殊重合候选排序靠后或淘汰。
- [ ] 实现两层搜索：解析构造器（直角底面、垂足、中点、比例）优先；有限参数网格作为兜底，最大候选数与计算预算硬限制。
- [ ] 每个候选先跑拓扑构造，再跑 `verifyDiagramObligations`；搜索器不维护第二套残差。
- [ ] GREEN：通过/矛盾/不支持题各有 fixture；失败说明候选数和主要失败原因。
- [ ] 复核：旋转/平移不影响数学判据；可读性只做 tie-break/ranking。

## Task 4：接入现有 Agent 编译和提示词

**Files:** `planCompiler.ts`, `draftStore.ts`, `systemPrompt.ts`, `localPlanner.ts`, Worker contract/strategy tests.

- [ ] 写 RED：模型未提供可靠坐标时，系统对首批题型能请求见证搜索；搜索产物含 `vertexNames` 和 assumptions；Worker/同步结果一致。
- [ ] 接线：保留模型直接提供合法坐标的快速路径；只有缺值且题型受支持时调用 WitnessSearch；候选耗尽走 no_witness。
- [ ] 提示词明确：模型可以提供候选，但不需要自证；若系统能生成见证，不要因“任意”静态画图而强行符号化。
- [ ] GREEN：现有代表题、欠定正例、错误题、Worker 回退全部通过。
- [ ] 复核：没有任何候选时不产生半份草稿、不绕过确认门禁。

## Task 5：真实 Provider Benchmark

**Files:** Create `scripts/agent-benchmark/` runner, dataset schema, redaction and report tests; docs only, no CI secret.

- [ ] 写 RED：JSONL 数据集缺字段、泄露 secret、结果缺 `provider/model/seed/status` 时拒绝报告。
- [ ] 实现题集分层：可构造欠定、矛盾、未支持表达式、顶点顺序扰动、二面角/比例、静态“任意”、普遍证明请求。
- [ ] 每题执行最多 3 轮；记录 pass@1/pass@3、题设覆盖率、verified/unverified/no_witness、成本、延迟、人工可读性标注。
- [ ] 输出同时保留 `deterministic_local` 和 `real_provider` 模式，格式明确区分。
- [ ] 手工用至少一个真实 provider 跑小样本，建立 baseline；没有凭据时报告 `not_measured`，不伪造数字。

## Task 6：真实浏览器与发布门槛

**Files:** Add `e2e/agent-witness-search.spec.ts`; update acceptance/release docs.

- [ ] 写正例：缺数值但约束充分的题，系统生成一组示意图，显示示例值并允许确认。
- [ ] 写反例：矛盾题、未支持题和要求普遍证明的题，不出现“已证明/确认提交”。
- [ ] 运行全部旧门禁与 benchmark schema tests。
- [ ] 只有真实 provider baseline、人工可读性抽查和旧门禁都满足，才评估是否把 WitnessSearch 默认启用。

## 文档收口

- `docs/current-status.md`：记录真实 provider 是否已测、下一轮状态和当次门禁数字。
- `docs/feature-catalog.md`：记录见证搜索支持的题型边界，不扩大为“所有高中题”。
- `docs/project-progress.md`：追加归档条目，保留失败候选与被拒方案。
- `docs/acceptance/agent-release-gate.md`：增加真实 provider baseline 与 witness coverage 门槛。
- `docs/acceptance/agent-tool-loop-scorecard.md`：区分实例合法率、题设覆盖率、人工可读率和模型 pass@1/pass@3。
- `CHANGELOG.md`：只记录已经实际实现和实测的内容，不提前写未来能力。