# 高中作图题 Agent 与自动 Lean 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each task uses `- [ ]` checkboxes, RED→GREEN and an independently reviewable commit; do not spawn agents unless the user separately asks.
> **状态（2026-10-06）**：按用户最新裁决只覆盖确实需要作图的题；V0 已有作图候选目录与四家族 12 条**内部文字/坐标候选**，还不是图元运行证据；V1–V3 未实施。原 [全课程路线](2026-10-06-agent-next-round-implementation-plan.md) 除已核实的来源与之前审查记录外均为历史范围。

**Goal:** 让 Agent 在高中**需作图题**生成、核验且解释符合题设的直觉图；条件欠定允许自由点，形式证明只在可靠地形式化原题后对有关作图目标自动调用 Lean；不是让 Lean 解所有高中非作图题。

**Architecture:** 题目级作图意图 + 可复核的来源子型目录 → 图形场景候选/逐条判据 → 示意图/普遍证明严格分级 → 桌面受限 Lean 自动任务 → 可读证据与真实模型评测。章节标签只是候选；用户明确要求画图可以覆盖非图默认值，未知状态不能自动归入“无需图”。

**Tech Stack:** TypeScript/React/Vitest、geometry-kernel、scene-graph、Tauri Rust、Lean 4/mathlib、Playwright。

**Spec:** [作图范围修订](../specs/2026-10-06-diagram-scope-addendum.md)（最新范围）+[原统一 IR 设计历史前提](../specs/2026-10-04-agent-full-next-phase-design.md)。**当前任务与残余风险：** [下一轮追踪](../../agent-next-round-progress.md)。

## Global Constraints

- **分母**：按题目是否需要图，不以旧全课程 43/141 目录或包含集合、数列的全科题集充数；高考评析只有候选线索，未得原题+答案时不称高考金标。
- **欠定可画**：自由点可选直觉位置，但候选须满足所有可判题设；若图无法确定唯一答案，图可以仍画，唯一答案另报 `underdetermined`；实例图不可变成普遍证明。
- **证明**：自动 Lean 只服务作图题关联主张；前提不能从模板偷偷加给题目，辅助引理不得冒充原题证明；`sorry`/超时/无后端不可升级证据。
- **开关与评测**：默认行为旧路径原样，浏览器缺桌面桥如实报 unavailable；付费 provider 测试必须另获显式许可，离线分数不等于真实成功率。
- **每完成一个独立区块**：RED 失败原因有执行证据 → 最小 GREEN → 定向/所涉工作区/浏览器真验 → 更新 current-status/agent-next-round-progress/feature-catalog/project-progress/README/门禁相应处 → 单独 commit/push 并核对远端 SHA；慢 Lean 集成独立运行。

## 文件职责与真实调用点

| 文件/模块 | 责任与边界 | 测试/调用点 |
| --- | --- | --- |
| `docs/taxonomy/high-school-2025-source-index.json`、`high-school-2025.json` | **历史来源清册**（2025 标准元数据），不再是新覆盖分母；不删除之前可核对的来源 | `scripts/curriculum/catalog.test.ts` |
| `docs/taxonomy/diagram-scope-2025.json`、`scripts/curriculum/diagramScope.ts` | 每个子型默认意图与未知缺口；实际入选由题目级 `required` 决定，不接受关键词/章节自报已核验 | `scripts/curriculum/diagramScope.test.ts`；V1 接到 `apps/web/src/agent/agentRunner.ts` |
| `docs/taxonomy/curriculum-gold-cases.json`、`scripts/curriculum/goldCases.ts` | 三角、圆锥曲线、导数函数图像、空间关系的正反欠定**内部**案例；文字/坐标候选不等于 kernel 验证 | `scripts/curriculum/goldCases.test.ts` |
| `packages/agent-core/src/obligationIR.ts` / `planCompiler.ts`；`apps/web/src/agent/draftStore.ts` | 原文→约束/目标/自由点与报告的真实调用点；未知图形条件 fail-closed | 工作区和几何 Worker 契约测试、宿主真实草稿确认 |
| `packages/geometry-kernel/src/`、`packages/scene-graph/src/` | 四类场景的判据、自由点见证与事务/拖动；无判据不静默提交 | 正反核验和拖动撤销浏览器用例 |
| `packages/agent-core/src/proof/`、`proof/lean4/`、`apps/desktop/src-tauri/src/commands/` | Lean 来源、前提消解、后端版本/许可/受限进程、artifact | `npm.cmd run proof:smoke` + 独立真 Lean + Rust + 产品 UI |
| `apps/web/src/agent/fixtures/benchmarkPlanningEval.ts`、`packages/agent-core/src/benchmark/report.ts` | 同一作图题集的真实 provider/人工教学可读性/成本证据，绝不混作形式证明 | 人显式确认付费请求后的独立报告 |

## V0：作图题分母、四类正反/自由点候选（当前区块）

**接口**：`DiagramIntent = required|helpful|none|unknown`；`resolveDiagramIntent(defaultIntent, explicitDrawRequest)`；`auditDiagramScope(sourceIds, decisions)` 返回 `visualCandidateSubtypes/requiredSubtypes/nonDiagramDefaults/unknownSubtypes/duplicateIds/outOfScope/ready`；`GoldCase.diagram = { family, intent:"required", witnessCandidate:{description,freeChoices} }`。文案“候选”表示尚无核验图元。

- [x] **RED 已实测**：四类候选漏报、helpful 缺图形族别、所有目标被标非图却假通过、none 遇题目明确画图不升级、未审 134 项被默认为排除，先分别失败；原有纯集合/数列九例不能满足新 12 条作图数据；欠定自由点或无图候选的反向断言先失败。命令：`npm.cmd exec vitest run -- scripts/curriculum/diagramScope.test.ts scripts/curriculum/goldCases.test.ts --reporter=dot`。
- [x] **内部 GREEN（尚未对外发布）**：4 个视觉候选子型 `helpful`，纯集合/数列/三角恒等式默认 `none`，其余 134 项 `unknown`；原创 4×3 个文字/坐标候选包含 4 条欠定自由选择；`auditCoverage` 仍因大批未审返回 false。**不得勾成产品图正确。**
- [ ] **V0 出口**：让每例生成可重放的实际图元/函数图，内核逐条核验题设与候选位置；模糊输入反例拒绝确认，欠定自由点“有可用图”与“答案不唯一”同时为真；关旗旧路径有真浏览器反例。没有 e2e 与人看图确认时此项保持未勾。
  - **2026-10-10 逐条对账（机器那半已齐；**出口仍不勾**，缺的是人那半）**：

    | 出口条件 | 证据（当次实跑） |
    | --- | --- |
    | 每例生成**可重放**的实际图元 / 函数图 | 四家族浏览器正例 **15 passed**（`agent-diagram-free-apex` 6 条 / `agent-planar-triangle` 1 / `agent-conic-ellipse` + `agent-conic-kinds` 3 / `agent-function-tangent` 1 / `agent-underdetermined-diagram` 2 / `agent-conic-invariant` 2），每条都**提交后重放**：读落盘坐标/参数、由测试自己算 |
    | 内核**逐条核验**题设与候选位置 | 定向 **6 文件 / 157 通过**（`planCompiler` + `draftStore` + `workerContracts` + `planar-constraints` + `diagramScope` + `goldCases`）；四家族的核验在浏览器里也各有一条"独立回代"（如 `agent-diagram-free-apex` 的"re-verifies the committed tetrahedron from the document's own coordinates, independently of the panel"） |
    | 模糊输入**拒绝确认**（反例） | `agent-underdetermined-diagram`（"additional unsupported condition is visible and cannot be committed"）、`agent-conic-invariant`（符号参数保留、数值采样如实标注、等用户）、`agent-diagram-free-apex`（"above the base" 不静默丢 + 与题面矛盾的坐标被拒） |
    | 欠定自由点"**有可用图**"与"**答案不唯一**"同时为真 | `agent-underdetermined-diagram`（欠定四棱锥通过核验、**以示例呈现**、可确认、一步撤销）+ `agent-diagram-free-apex`（自由点取示例值、面板写明"不是普遍证明"） |
    | 关旗旧路径有**真浏览器反例** | `agent-diagram-free-apex`（"when disabled, the same previously unsupported prompt does not create a point or a draft"）+ `agent-solid-family-path`（开关关着时同一句台体题面不产草稿、不占撤销历史） |
    | 每例的**可目检图** | `docs/evidence/` 六张（V0a/V0b/V0c×3/V0d）。**2026-10-10 逐张看过并记录所见**：V0a 底面 B/A/C 在地面网格、顶点 D 在其上方（15 个对象）；V0b C 在 A 正上方 ⇒ AC⊥AB；V0c 椭圆横长竖短（半轴 3/2）、双曲线左右两支、抛物线开口朝 +x；V0d 三次曲线 + **过局部极小点的水平切线**（与 f′(1)=0 一致）。**逐张与它自己的标签/方程相符。** |
    | **人看图确认（教师 / 学生走查）** | **未做** —— 这一条是本项保持未勾的唯一原因。它记在 [当前状态](../../current-status.md) §四 A（用户侧验收），不需要管理员权限，但**必须由人来做**：给教师/学生看这四类图，确认"图看得懂、直觉对"。**本项不得由机器证据顶替。** |

- [x] **V0 区块收口**（2026-10-10 完成）：定向 **6 文件 / 157 通过**（V0 点名的那几个：`planCompiler` / `draftStore` / `workerContracts` / `planar-constraints` / `diagramScope` / `goldCases`）；四家族 + 反例 e2e **15 passed**；全库非 Lean + 全量 e2e + `typecheck` + `lint` 的当次读数见本块提交的 CHANGELOG；文档（`current-status` §四 A/F、`agent-next-round-progress`、`project-progress`）同步；**数据卫生**（BOM / 行尾 / 断链 / 引用 SHA）当次扫过；**截图六张逐张目视核对**（见上表最后一行）；单独 commit + push 后以 `git ls-remote` 与本地 HEAD 当场比对一致。

### V0 产品路径的实地审查（2026-10-06，仅调用点定位，不是能力交付）

- `packages/agent-core/src/planCompiler.ts` 的原话清单/`verifyDiagramObligations` 只在 `solid.create_polyhedron` 后执行；`apps/web/src/agent/draftStore.ts` 对同一动作重算。**其它三家族现阶段不能因为“动作编译成功”就算题设已核验**。四面体另有 `solid.create_tetrahedron`，不能未经测试假设它自动进入上述校验。`diagramObligations.ts` 当前可读 `AD⊥平面ABC`，但没有可证已核验原文中“D 在上方”以及点坐标的一整套判据；带 `=` 的坐标可能留下未核验残项，不带 `=`/方位短句有静默遗漏风险。V0a 必须通过反例钉住**所有原话条件**，而不是只守一条垂直关系。
- 现有 `planar.create_point/segment/conic` 能产生 2D 图元；圆锥曲线的创建动作在 `actionRegistry.ts` 与编译器可用，但题目焦点、半轴、退化与原文对应的报告缺乏统一验证。三角形用点/线段形成候选，也须证垂直及自由点条件。
- `packages/dsl/src/types.ts` 有 `type:"function"`，场景图可重算函数曲线/切线；Agent 动作表只有 `function.analyze` / `function.create_tangent`，**没有创建函数图像动作**。`apps/web/src/agent/agentRunner.ts` 的自动切工作区目前只认 `planar.*`、`solid.*`、`section.*`、`dynamic.*`；新动作要同时进入动作名/Schema/编译器/工作区/Worker 传输/端到端，不能只加按钮。

### V0a–V0d 可独立拒收的实施区块（**每一块**先 RED→GREEN、更新文档并推送）

| 次序 | 首个可复核图 | 写入职责 / RED | 产品出口（未达） |
| --- | --- | --- | --- |
| V0a 立体自由顶点 | 第一条题面仅声明线面垂直与自由点 D（不擅自把正高度当题设）；内部候选可取 D(0,0,2)。**另把显式 A=(0,0,0) 与 D 在底面上方列为独立 RED 条件**，错误坐标或 D 下方不得凭“AD⊥平面”过关 | `packages/agent-core/src/planCompiler.test.ts`、`apps/web/src/agent/draftStore.test.ts`、`e2e/agent-diagram-free-apex.spec.ts`：逐项核验现有可识别线面关系，坐标/上方若未可靠解析必须报 `unverified` 并拒绝正常确认；补判据后才放行。正例图不唯一、错误 D 与空报告拒绝，关旗旧路径不变 | 真浏览器看到四面体、条件状态一致；拒绝不占撤销历史；合法自由点图可确认但不宣称唯一；文字坐标/方位不能静默丢 |
| V0b 平面三角 | A/B/C 实际点线段、AB⊥AC 与欠定 C | `packages/geometry-kernel/src/planar-constraints.test.ts`、`packages/agent-core/src/planCompiler.test.ts`、`apps/web/src/agent/workerContracts.test.ts`、`apps/web/src/agent/draftStore.test.ts` + e2e：三点真实坐标点积正确，AB∥AC 反例红；未支持题设列 unverified | 图像存在、条件逐项核验、欠定 C 允许一张示意图 |
| V0c 圆锥曲线 | 椭圆半轴 3/2，焦点 ±√5 与焦点轴反例 | 复用 `planar.create_conic`，在几何内核加独立判据、解析题面 IR 与草稿重算；新 e2e 需对错焦点拒绝及浏览器真实椭圆判据，不读模型自报证据 | 真椭圆 + 焦点/退化可判，关旗旧路径不变 |
| V0d 导数曲线 | `f(x)=x³−3x` 真图与 x=1 水平切线 | 新 `function.create_graph`（名字可在 RED 时定）须经过 `actionIds.ts`、`actionRegistry.ts`、`actionInputs.ts`、编译器、`agentRunner.ts` 工作区/Worker；对切线 `f′(1)=0` 做内核/草稿正反验证 + e2e | 真函数图和切线同时显示，错误斜率不能正常确认 |

**每块 RED 运行**：先新建能执行的断言文件（不存在文件/权限报错不算行为 RED），再运行 `npm.cmd exec vitest run -- packages/agent-core/src/planCompiler.test.ts apps/web/src/agent/draftStore.test.ts apps/web/src/agent/workerContracts.test.ts --reporter=dot` 和新增内核文件；浏览器 V0a `npm.cmd run test:e2e -- e2e/agent-diagram-free-apex.spec.ts --workers=1`（V0b–V0d 实施时另建对应文件）。关 flag 必须钉旧拖动与旧静态示意图路径，默认不触发自动 Lean。所有 RED 要点名原题条件/具体图元/残差或不支持原因；**创建了一个图元**从来不等于**题设全部验证通过**。

> **V0a 暂存（2026-10-06，未勾选 V0 出口/收口）**：已落地受限自由顶点三棱锥的实验性本地意图、一般位置三角底面示例、坐标来源 IR 与实际点核验、草稿/Worker 再核验和 3 条开关正反浏览器用例；定向 7 文件/171、单份 e2e 3/3，typecheck 和 lint 通过。**仍缺**浏览器真实点坐标独立回代与截图目检、错误坐标浏览器拒绝反例、全库/全量 e2e 及教师可读性走查。`D在底面ABC上方` 目前为 `unverified`，不是已算空间方位；四家族整体及自动 Lean 均未达成。此条只留中途恢复证据，不修改未勾的产品出口复选框。

## V1：画图与约束求解扩大到这四类题

- [x] **RED**（**2026-10-10 逐条对账完成**）：对同一组三角、椭圆焦点/退化、三次曲线切线/极值、空间线面关系，用错误参数生成候选必须红，合法自由点图要绿；无空间判据约束不得被拖坏。将 `verified_instance/unverified_instance/no_witness` 与主张状态分离，不把未核验当通过。落点 `packages/geometry-kernel/src/*.test.ts`、`apps/web/src/agent/agentRuntime.test.ts` 和 `e2e/` 对应场景。
  - **"错误参数必须红"逐族落点（都在，逐条读过）**：**三角** —— `packages/agent-core/src/planCompiler.test.ts:971`：同一句话、同一套动作，只把 C 挪到 `AB` 射线上 ⇒ `AB⊥AC: failed` 且 `ok=false`（**这就是 V0b 点名的 `AB∥AC` 反例**）；`:979` 点名点没进文档 ⇒ `unverified`，不按"没有就跳过"处理。**圆锥曲线** —— `diagramVerification.test.ts:327`（半轴一样、**轴反了** ⇒ failed）、`:333`（半轴互换 ⇒ failed）—— 只比数值不比轴就会放行，这两条正是不放行的那一侧。**切线** —— `diagramVerification.test.ts:244`（`tangentAt: failed`），浏览器侧 `agent-function-tangent` 只做正例。**空间线面** —— `relations.test.ts` 的残差用例 + `planCompiler.test.ts` 的 `relation_not_satisfied`（S3.4 那一族）。**合法自由点图要绿** —— 四家族浏览器正例 **15 passed**（V0 对账表）。
  - **"无空间判据约束不得被拖坏"** —— `apps/web/src/constrainedDrag3.test.ts`：关开关 **passthrough**（旧路径逐字回归）、斜着把平面上的点拖出去**贴回平面**、沿法向拖**约束完全抵消并如实报 `noop`**（不提交空事务）、冗余约束**不阻止提交但要在提示里说出来**、锁定/绑定点交给旧路径。浏览器侧另有 `e2e/agent-constrained-drag.spec.ts` 正反例。
  - **三值状态与主张状态分离** —— `packages/agent-core/src/claimEvidence.test.ts` + benchmark 契约（`BENCHMARK_STATUSES_BY_LAYER.witness`）；**未核验不当通过**：`apps/web/src/agent/agentRunner.test.ts:45`"把每一条未核验的题设条件用中文列出来，并且不提供确认"。
- [x] **GREEN**（**2026-10-10 逐条对账完成**）：复用现有解析点/圆锥曲线/导数切线/3D 图元，先解析构造受支持题，再用有界数值见证处理自由点；若条件不足而存在多图，选择一组直觉代表，列出自由度与未核验义务；若矛盾/超时/不支持按独立状态拒绝伪提交。
  - **逐条**：四家族都复用**既有**图元（`planar.create_point/segment`、`planar.create_conic`、`function.create_graph` + `function.create_tangent`、`solid.create_polyhedron`），没有为某一族另造图元；自由点走**有界数值见证搜索**（`witnessSearch`，固定小整数网格、无 RNG）；**多图时取一组直觉代表并把它选了什么写出来** —— `assumptions` 里逐条列"系统自选/搜索器自选"（S3/S5 各族的证据，面板上用户确认前可见）；矛盾 / 超时 / 不支持**各自独立状态**拒绝伪提交（`no_witness` / `unverified_instance` / `rejected` 分开，见上一条）。
  - **如实记一处**没有**做的**（不是漏，是裁决）：`ClaimEvidence.degreesOfFreedom` **仍然是 `null`** —— R33 的结论与理由写在 `witnessSearch.ts:64-66/785-801`（N1 唯一的实现要 DSL `ConstraintSpec[]`，而拿见证候选自证会把公共尺度自由度"算掉"，那是自证）；`claimEvidence.test.ts:48` 把它钉住。**"数值自由度"与"系统替你选了哪些值"是两件事**：后者**有列**（自由标量与 assumptions），前者没算，归后续（其主题本来就是拖动自由度）。**不要把这条读成"V1 已列出自由度"。**
- [x] **本块发布前条件**（**2026-10-10 核实完成**）：四家族正反/欠定示例各有实际浏览器图、数学条件核验与失败说明，默认 flag 关闭旧路径不变；进度与 GitHub 同步。**不要拿 12 条内部文本例声称完成 V1。**
  - **证据就是真实浏览器图**：四家族 e2e **15 passed**（每条提交后重放、读落盘坐标/参数自己算）+ `docs/evidence/` 六张逐张目视核对；**失败说明**在反例里（拒绝确认并说清是哪条条件、为什么）。**默认 flag 关闭旧路径不变**：关旗逐字不变契约 `planCompiler.offPath.golden.test.ts` + 关旗浏览器反例（`agent-diagram-free-apex`、`agent-solid-family-path`）。**那 12 条内部文字/坐标候选一条都没有被当成 V1 的证据**（它们只证明目录与意图分级，不证明能画对）。

## V2：限定作图题的自动 Lean

- [x] **RED**（**2026-10-10 逐条对上**）：模板凭空增前提、证明了别的图形主张、删题设/换目标、`sorry`/未接后端/超时/旧 run 回包，均不得将**原题**升到 `formally_proved`；辅助引理可单独标明。对应 `packages/agent-core/src/proof/*.test.ts`、`apps/web/src/agent/*.test.ts`、Rust 命令测试。
  - **逐条落点（每条都在文件里读过，`proof:smoke` 8/8 通过）**：**`sorry`** —— `lean4Adapter.test.ts:86`"`sorry` 必须被拒（它的 exit code 是 0，所以退出码在这里不算数）"；用户自定义 `axiom` 也拒（`:94`）；**"证明了别的图形主张"** —— `:116`"报告是**别的定理**的（例如只报了一个引理）也拒：名字必须逐字对上"；**删题设/换目标** —— `:258`"命题原文进 `statement` 那一栏 —— 模板一改它必变"（产物与命题原文绑定，改了就对不上）；**未接后端** —— `:190`"后端不可用 ⇒ `unsupported`，而且不是 `failed`" + `proofArtifact.test.ts:97`"形状合格 ≠ 真的验过：**没接入**的后端送的产物过不去"；**超时** —— `:178`"进程级墙钟超时 ⇒ `timeout`，绝不把被杀掉的那次算作通过"与 `:358`；**旧 run 回包** —— `workerContracts.test.ts:125`"rejects a stale result that answers a different request"；**升级边界** —— `proofArtifact.test.ts:77/97/187` 与 `lean4Adapter.test.ts:329/479`（篡改过的产物喂回闭环 ⇒ 状态**不升**）。
  - **"辅助引理可单独标明"**：`proofGoals.test.ts` 的推断路线（勾股"先证 ⊥、再走那一步定理"且定理要**点名**）与 `lean4Adapter.test.ts:220`"生成的命题**是一般命题**（任意内积空间 + 任意子空间），不是某一组坐标"。
- [ ] **GREEN**（**2026-10-10 部分：目标类由一类加到两类（性质定理 + 判定定理，后者真跑通过）+ 目标按点名形状消解 + 前提桥（四类来源，凭空编就失败）；产品调用与桌面命令两条缺口未动，不勾**）：按作图题目标（几何关系、曲线性质、切线/导数、立体关系）逐类做可信翻译、前提消解、受限桌面 Lean 调用和绑定产物；关闭 proof flag 或浏览器无工具链时不阻塞作图。mathlib revision pin、许可证/体量/线程/WASM/超时与隔离审查必须在默认启用前完成。
  - **已有**：`lean4Adapter`（报告白名单 + `#print axioms` 检查）、`proofGoals`（目标词表与载体）、`proofArtifact`（产物绑定与升级判据）、`proofBackendAdmission` / `proofBackendReview`（接入名单**由 passed 记录推导**，不是手写数组）、`lean4Toolchain`（找不到工具链 ⇒ `null` ⇒ 显式 gated 跳过，**不静默通过**）。**"关 proof flag / 无工具链不阻塞作图"**：`proofExport` 默认 `false`（`featureFlags.test.ts:30`、`nextPhaseEntry.test.tsx:46` 钉住），工具链缺失返回 `null`（`lean4Toolchain.test.ts:124/129`），后端不可用是 `unsupported` 而不是 `failed`（适配器用例）；四家族浏览器正例都在默认（proof 关）下通过。
  - **缺口（四条，逐条指得出落点）**：① **逐类可信翻译到 2026-10-10 为止是**两类**（还是不够）** —— `perpendicular`（**性质定理**：已知线⊥面 ⇒ 它⊥面内任意线）与 `linePlanePerpendicular`（**判定定理**（原叫 `planePerpendicular`）：线⊥面内两条**相交**线 ⇒ 线⊥面，2026-10-10 加）。两条都是**一般命题**、都在本机真跑过（`formally_proved` / 三个白名单公理 / 判定定理 68392 ms），且**定理名不同**（一份 `#print axioms` 报告不能冒充另一类，有用例钉住）。**还没到的**：**曲线性质 / 切线·导数 / 其余立体关系**都还没有模板 —— 所以这一条**只是第一刀，不能勾**。② **前提消解 / 原题前提桥 —— 2026-10-10 做了两步，但**不是"桥已完成"**：(a) **目标按点名形状消解**（`declaredProofGoalForObligation`：`perpendicular` / `parallel` 各承载"线与线 / 线与面"两种读法，按点名个数分流；**面⊥面今天没有目标**，如实返回 `null` —— 这条同时修掉了一个真错配：原来"线⊥面"那条目标叫 `planePerpendicular`，与解析层那个**面⊥面**的 kind 同名并被声明为载体）；(b) **前提桥**（`proofPremiseBridge.ts`：每条前提标成 `fromText`（题面原句）/ `fromDerivation`（一步定理，**点名**）/ `fromFigure`（图形蕴含，**必须列出来**）/ `invented`（凭空编 ⇒ `ok=false`，**不许生成命题**））。**还没做到的**：原题**其余**题设（底面是什么形状、P 在平面外…）**仍然不进命题** —— 命题至今是"关于任意点的命题 + 那几条被点名或有出处的前提"，不是"这道题的完整形式化"；③ **产品侧自动调用与产物通道没有**（没有任何一条产品路径会去调 Lean）；④ **受限桌面调用没有** —— Rust 侧**一个 proof / lean 命令都没有**（`apps/desktop/src-tauri/src` 全树 grep 只有一处无关的 "proof" 字样；241 个 Rust 测试里没有证明相关）。**"默认启用前"那批审查**（mathlib revision pin / 许可证 / 体量 / 线程 / WASM / 超时 / 隔离）**已有一份很详细的 `proofBackendReview` 记录**（`proof:smoke` 打印：版本逐字、许可证读自安装目录正文、进程模型、原生依赖清单、启动预算、两层超时策略、`sorry`/`axiom` 的失败行为、工具链 3095.9 MB / mathlib 每工程 7.52 GB），**但其中一条自己就写着未测**：**"强沙箱（只读 + 无网络）下的证明运行未测"**。
- [ ] **实测**（**2026-10-10 部分：真实工具链这一半已定位为冷缓存并热跑复现，桌面真 UI 仍缺，不勾**）：真实工具链单独集成和桌面真 UI；无法完整翻译原题时只能显示实例图或“辅助引理已证”，而不是普遍证明。各阶段都按文档与远端 SHA 提交。
  - **本批实跑（单跑 `npx vitest run scripts/proof-spike/lean4EndToEnd.test.ts`，1030.47 s）**：**3 passed / 1 failed**。红的是"**真证明 ⇒ `formally_proved`**"那一条：**`status=verified_instance judgement=timeout exit=null 300015 ms`** —— 撞上进程级墙钟上限（300 s）被强杀，适配器**如实报 `timeout`、不返回半成品**（这是它该有的行为）。同一次运行里的导入宽度测量：**narrow = 69021 ms**（与文档里那次 68 s 吻合）/ **full Mathlib = 583065 ms**（文档里那次约 150 s）。
  - **归因已定，且已复现（2026-10-10 补跑）**：上一条红色是**冷缓存的第一次** —— 紧接着只跑那一条（`-t "真证明"`）得 **`status=formally_proved` / `judgement=verified` / `exit=0` / `69071 ms` / axioms `["propext","Classical.choice","Quot.sound"]`**，**与文档里 68277 ms 的历史读数吻合**（差 1.2%，属同一量级；**改完失败文案后再跑第三次：67954 ms / `verified` / `exit=0`**，同一读数）。**机理**：mathlib 展开后每工程 7.5 GB olean，第一趟要把它们读进页缓存，成本全在第一趟；`timeout` 是**只读一次**的结果，不是能力缺失。**⇒ 上一版写在这里的"原因未定论 / 本机不复现"作废，改记为本条**；`sorry` 那条两种情况下都正确（`exit=0` 但 `judgement=failed`，报 `sorryAx` 表外公理），导入宽度两侧都 `exit=0`。**已把"冷跑超时 ≠ 回归，先热跑一次再判"写进那条用例的失败文案**（`scripts/proof-spike/lean4EndToEnd.test.ts`），避免下一个人重复这次误判。**不改预算、不放宽判据**（预算不是病因，改它只会掩盖冷启动成本）。
  - **桌面真 UI 仍未做**（也无法在无人值守下做）：真桌面（Tauri 窗口）里跑一次自动 Lean 并核对产物，需要人操作；列进"等你点头"那一栏。**加上缺口④（Rust 侧没有任何 proof / lean 命令）**，这两件事要一起做：先有桌面调用面，才有"桌面真 UI 实测"。

## V3：作图题真实质量与发布

- [ ] **旧问题归属**：N1 证据互斥与来源区间、N2 撇点名/自由点及文档自由度、N3 其它未支持空间约束安全拖动、N4 多题真实 provider 质量/成本/超大响应、N5 实际产物通道及版本固定、文件卫生全部分块跑 RED/GREEN；历史已修项保留证据不重做。
- [ ] **评测与发布**：真实 provider 仅经人确认付费，按作图家族和题设覆盖/可读性/错图率/成本/延迟各报分母；教师/学生图形直觉走查与管理员 MSI 安装验收分开。没有完整金标和真实用户/端到端数据前不宣称“支持全部需要画图的题”。

## 已废止的旧范围与后续分块

2026-10-06 用户将“全课程所有题型”收窄为“**需要画图的内容即可**”。[旧全课程计划](2026-10-06-agent-next-round-implementation-plan.md) 的 H0–H4 / 43 表层 / 141 一级要求只记录此前真实来源盘点，不再作为新产品完成目标；高考评析 8 候选主题也不等于已核验的作图高考题。下一独立区块先补 V0 产品图元+核验，再走 V1/V2/V3；每块有单独文档、门禁、提交与推送。
