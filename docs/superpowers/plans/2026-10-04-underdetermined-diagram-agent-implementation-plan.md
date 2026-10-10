# 欠定高中几何示意图 Agent 升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 当前任务由主会话直接执行，不授权额外 subagent；每项按 RED→GREEN→复核前进。

**Goal:** 允许自由点产生一张清楚的静态示意图，同时让所有支持的题设在真实确认路径上逐项核验，未核验与失败绝不冒充通过。

**Architecture:** 用户原话由系统生成带来源的题设清单，模型只提供候选图；纯几何判据在隔离候选图上评估，并把结构化结果传到现有 `verificationGate` 与确认 UI。欠定是合法的示例选择，不等同于“未核验”；普遍证明和动态保持关系独立于此切片。

**Tech Stack:** TypeScript、Vitest、Playwright、React、现有 scene-graph/geometry-kernel/agent-core、Web Worker。

**Spec:** `docs/superpowers/specs/2026-10-04-underdetermined-diagram-agent-design.md`。

## Global Constraints

- 先只作用于有可靠点名映射的 `geometry3d` 多面体示意图；其余功能回归不变。
- 题设与待证结论分开；模型自报 `relations` 不能取代原话题设。
- 仅 `passed` 且覆盖完整才能展示“条件已核验”；未验要有来源和原因；失败不正式提交。
- 同一编译器负责 Worker 与当前线程回退；同一候选必须得到相同结论。
- 现有一次性修复额度、文档版本/预览哈希/用户授权、一步撤销不变。
- 静态示例不被称为唯一解、动态约束或普遍证明；不引入通用求解器。

## 文件职责

- 新建 `packages/agent-core/src/diagramObligations.ts` 和 `.test.ts`：用户题设/目标边界、高精度句型及无法识别片段的结构化记录。
- 新建 `packages/agent-core/src/diagramVerification.ts` 和 `.test.ts`：名字→最终候选坐标映射、量纲明确的单条数值/关系验证、报告汇总。
- 修改 `packages/agent-core/src/planCompiler.ts`、`.test.ts`：把上述报告放入编译结果并将失败送入现有一次修复路径。
- 修改 `apps/web/src/agent/draftStore.ts`、`geometryCompileStrategy.ts`、`geometry.worker.ts` 及测试：同步/Worker 带同形验收报告与题面来源。
- 修改 `packages/agent-core/src/committerAdapter.ts`、`coordinator.ts` 及测试：真实空间作图请求即使没有外部 acceptance 也检查题设；不放松其它调用路径。
- 修改 `apps/web/src/agent/agentRunner.ts`、`apps/web/src/agentStore.ts`、`apps/web/src/components/agent/ConfirmationPanel.tsx` 及测试：人能看到通过/失败/未核验与示例取值；非绿草稿无正常确认。
- 修改 `packages/agent-core/src/underdetermined.ts`、`apps/web/src/agent/systemPrompt.ts` 及测试：静态画图与证明/动态任务分流。

## Task 1：系统持有的题设清单（纯函数）

**Interfaces:** `parseDiagramObligations(prompt: string): DiagramObligationSet`，含 `givens: DiagramObligation[]`、`goals: string[]`、`unverified: { sourceText: string; reason: string }[]`；`DiagramObligation` 保留 `sourceText`、`kind`、目标点名、`value?`。不依赖模型 envelope。

- [ ] **Step 1: 写 RED 用例**：输入 `在三棱锥 A-BCD 中，BD=2，△OCD为等边三角形，AB=AD，O为BD中点，DE=2EA，平面ABD⊥平面BCD，二面角E-BC-D=45°。求证 OA⊥CD`。断言 givens 能逐字追溯定长/等边/等长/中点/分点比例/面面垂直/二面角；`OA⊥CD` 只进 goals。另测不支持的“∠ABC=60°”产生带原文的未核验，不返回空成功。

```ts
const parsed = parseDiagramObligations(prompt)
expect(parsed.givens.map(({ kind }) => kind)).toContain("dihedral")
expect(parsed.goals).toContain("OA⊥CD")
expect(parsed.givens.some(({ sourceText }) => sourceText.includes("OA⊥CD"))).toBe(false)
```

- [ ] **Step 2: 跑 RED**：`npm.cmd exec -- vitest run packages/agent-core/src/diagramObligations.test.ts --maxWorkers=1`；须因函数未定义或缺目标断言失败，不接受环境错误冒充 RED。
- [ ] **Step 3: 最小实现**：用“求证/证明”的明确分界分离 goals；只消费高精度匹配（空白、中文标点可变）；每次匹配记录原文位置，未被消费的强几何信号追加 unverified。不解析任意自然语言，不猜名字或角的方向。
- [ ] **Step 4: 跑 GREEN 与回归**：同命令通过，再跑 `relationExtraction.test.ts` 与 `underdetermined.test.ts`；确认普通“比如”不误伤。
- [ ] **Step 5: 复核**：每种题设有一个只差一个字符的负例；清单不依赖 `plan.relations`。

## Task 2：几何独立验收（量纲与缺失三态）

**Interfaces:** `verifyDiagramObligations(set: DiagramObligationSet, plan: StagedPlanEnvelope, candidate: GeometryDocument): DiagramVerificationReport`；每条 `sourceText`、`status: passed | failed | unverified`、`expected?`、`actual?`、`reason`，汇总 `status` 和 `sampleValues`。数值判据复用 `relations.ts` 与 geometry-kernel 的现成向量/二面角方法，不复制一整套向量库。

- [ ] **Step 1: 写 RED 用例**：真实错误 A 高度 0.64 的实例不得全部通过；正确立体中的 `BD=2`、等长、等边、中点、分点比例、面面垂直和 45° 各自通过；单项坐标变异分别只指出相关条件；不写 vertexNames、重复名字、退化面都必须 `unverified`。

```ts
expect(verifyDiagramObligations(set, wrongPlan, wrongCandidate).status).not.toBe("passed")
expect(verifyDiagramObligations(set, unnamedPlan, candidate).checks.some(c => c.status === "unverified")).toBe(true)
```

- [ ] **Step 2: 跑 RED**：`npm.cmd exec -- vitest run packages/agent-core/src/diagramVerification.test.ts --maxWorkers=1`。
- [ ] **Step 3: 最小实现**：按 `vertexNames` 唯一映射，读取候选而非模型自述，补定长/等边/分点在线段/面面垂直/内二面角；失败为已计算但超容差，缺值/退化/映射不明为未核验。容差按 spec 各自量纲；验收既不更改文档也不吞异常。
- [ ] **Step 4: 跑 GREEN**：该文件及 `relations.test.ts`；按 0.64 与 1.33 的临界值检查读数。
- [ ] **Step 5: 复核**：出报告时断言 `checks.length >= givens.length`，即使无支持语法也有一条“无法核验题设”的记录。

## Task 3：编译与一轮修复，Worker 一致性

**Interfaces:** `PlanCompileResult.diagramVerification?: DiagramVerificationReport`；`StagedCompileResult`/Worker 消息增加同名可序列化字段；`compilePlan` 在候选文档已生成后验，而不是尚未物化时验。`failed` 成为带具体字段路径的编译诊断；`unverified` 保留结构化报告并进入确认门禁。

- [ ] **Step 1: 写 RED 集成用例**：同一题面在 `compileInProcess`、`compileInWorker`（仿真实 Worker）和 Worker 不可用的回退上，`sourceText/status/actual` 一致；错误角度触发仅一次 repair；缺名字不被下标猜中后“通过”。
- [ ] **Step 2: 跑 RED**：`npm.cmd exec -- vitest run packages/agent-core/src/planCompiler.test.ts apps/web/src/agent/geometryCompileStrategy.test.ts --maxWorkers=1`。
- [ ] **Step 3: 最小接线**：扩 `PlanCompileResult` 与 Worker 协议并完整传透，不在 Worker 另写验证器；把当前 `validateRelations` 中不可信的“题面首次出现顺序”回退改为未核验。
- [ ] **Step 4: 跑 GREEN**：上述测试及 `draftStore.test.ts`、`workerContracts.test.ts`、`compilerRepair.test.ts`。
- [ ] **Step 5: 复核**：检查同一输入同步/异步路径逐字段相同，失败不留下半个草稿。

## Task 4：空间图的强制完成门禁与 UI

**Interfaces:** 沿用现有 `VerificationReport`、`verificationGate`；结构化 `DiagramVerificationReport` 从草稿预览到 `AgentDraftView`，不从诊断文字反推。仅匹配本切片的空间作图任务自动启用；其它 workspace 未声明 acceptance 的旧行为维持。

- [ ] **Step 1: 写 RED 测试**：运行请求不提供 `acceptance`、规划出多面体时仍检查题设；错误图或未核验项不进入 `awaiting_confirmation`，无确认按钮；正确欠定图仍能到预览并展示 `通过 N / 失败 0 / 未核验 0` 与示例取值。
- [ ] **Step 2: 跑 RED**：`npm.cmd exec -- vitest run packages/agent-core/src/coordinator.test.ts apps/web/src/agent/agentRuntime.test.ts apps/web/src/components/agent/AgentPieces.test.tsx --maxWorkers=1`。
- [ ] **Step 3: 最小接线**：stage 返回完整报告，Coordinator 对本范围即使无外部 acceptance 也运行 gate；确认 UI 展示结构化结果；不改变 consent、CAS 与一步撤销。编译成功但题设未核验的预览不可正式确认。
- [ ] **Step 4: 跑 GREEN**：上述定向文件并复跑 `committerAdapter.test.ts`、`ConfirmationPanel` 关联组件测试。
- [ ] **Step 5: 复核**：失败理由指出原题句子；图形非唯一但已全部通过不被误拦。

## Task 5：合理自由值与“示意而非证明”说法

**Interfaces:** `isStaticDiagramRequest(prompt: string): boolean`：明确画图意图才允许静态实例；`selectWitness` 与 `systemPrompt` 保留“证明/动态”保留符号和不冒充证明的规则。自选 `assumptions` 注明示例值；只对已显式标明自由点的候选做小规模确定性尝试，全部候选重新通过 Task 2 验收；不创造通用解算器。

- [ ] **Step 1: 写 RED 用例**：`画一张任意四棱锥的示意图` 允许数值见证，`证明任意四棱锥都...` 仍禁止特值证明；同一输入反复运行图一致，退化/特殊巧合不排在普通清楚的候选之前。
- [ ] **Step 2: 跑 RED**：`npm.cmd exec -- vitest run packages/agent-core/src/underdetermined.test.ts apps/web/src/agent/systemPrompt.test.ts --maxWorkers=1`。
- [ ] **Step 3: 最小实现**：把全局“任意→symbolic”改为有静态作图意图时允许选值；仅在明确自由点的有限候选中筛选通过题设和拓扑判据的实例，再按清晰性排序；假设写示例值，不写证明。若没有合格候选，如实失败/请求补充。
- [ ] **Step 4: 跑 GREEN**：定向测试与 `representativeFixtures.test.ts`；人工看原题一张清晰的实图。
- [ ] **Step 5: 复核**：把结论暂时误当条件的变异测试必须失败，任何视觉评分不得让不满足题设的图越过门禁。

## Task 6：真实浏览器回归和发布验收

**Files:** 新增 `e2e/agent-underdetermined-diagram.spec.ts`；更新 `docs/current-status.md`（只写当次真实读数与残留缺口）、`docs/feature-catalog.md`（明确静态见证边界）。

- [ ] **Step 1: 写 RED 端到端用例**：完整会话发“欠定但可满足”的多面体请求，核对验证摘要、示例值与确认；换错误数值时检查原题句子警告、确认不可点、真实文档不变。
- [ ] **Step 2: 跑 RED**：`npm.cmd run test:e2e -- e2e/agent-underdetermined-diagram.spec.ts --workers=1`。
- [ ] **Step 3: 最小连线与文案修正**：沿 `agentRunner → agentStore → ConfirmationPanel` 传报告；UI 未通过时不出现“已验证”或原确认入口。
- [ ] **Step 4: 跑 GREEN 并全量门禁**：定向 Playwright、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd test -- --maxWorkers=3`、`npm.cmd run build --workspace @draw/web`、`npm.cmd run test:e2e -- --workers=3`、`npm.cmd run test:rust`；若沙箱阻止既有临时目录写入，按权限流程请求升级重跑。
- [ ] **Step 5: 审核**：原题真实错图不再静默通过；欠定正确图正常确认；清楚列出仍不支持的语法和非通用证明边界，再更新当前进度文档。

## 自查和执行纪律

每项只在 RED 为预期业务失败、GREEN 与关联回归实际通过后勾选。独立测试均不能代替 Task 6 的真浏览器验证；不得把“有检查报告”推断为“报告覆盖全部题设”。设计/计划先审查类型一致、术语和任务覆盖；执行时优先改当前模块，不做不相关清理。不要在未经验证的阶段把 `docs/current-status.md` 改写成完成态。
## 2026-10-04 执行记录（以当次测试读数为证）

- Task 1/2：题设清单与候选图残差已实现；七条题设正例和二面角错误、缺名、表达式前缀、退化与未知语法有独立回归。
- Task 3/4：编译、暂存、同步/Worker 等价、协调器门禁、宿主同意与确认界面均已接线；多轮暂存若不能重新核验前批条件，会如实退回“未核验”。
- Task 5：静态示意图与普遍证明已分流；既有见证族只在合条件且拓扑合法的候选中选择更易观察的一组。真实模型仍需提供候选坐标，未做通用候选自动生成与持久动态约束。
- Task 6：离线代表题浏览器正例与额外未知条件浏览器拒绝反例均通过；真实 AgentRunner/HostBridge 同样有拒绝用例。未在浏览器中模拟真实 provider 故意给错的整张图，不能把真实模型准确率写作通过。最终全库 287 文件 / 3319 项通过 + 1 todo，浏览器 186 通过；其它门禁见 `docs/current-status.md` §一。