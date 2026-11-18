# G3-F9 Action Kernel Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 DS 动作级工具“返回成功却零图元”的产品缺陷，让 DS 实际构造、读取、验证并交付题目所要求的图像；先对已证实的立体负例闭环，再按真实失败族扩展，不再用重复付费请求替代修复。

**Architecture:** 保留 `SpeculativeCanvas`、`DrawingIntent`、`constraintSolve3d`、`compilePlan` 与现有最终合同/证书；动作工具只在几何内核生成同版可测对象后返回 `accepted`。未实现的动作返回结构化 `blocked/unsupported_action`，从发布列表移除或接通真实执行；模型读数必须取候选快照和内核约束状态。`runFrozenDsCase` 的真实 DS 路径要生成按 scope/state/branch 标记的候选集合，而不是只产 `shared`。

**Tech Stack:** TypeScript、现有 `@draw/agent-core` / `@draw/geometry-kernel` / `@draw/scene-graph` / React、Vitest、Playwright、Tauri 原生凭据；不引入新运行时或外部 solver。

**Spec:** `docs/g3-final/G3-DS-final-implementation-dossier.md`（F1–F9）；负例真源 `docs/audit/2026-11-17-g3-f9-ds-action-pilot/README.md`，前次36题 `docs/audit/2026-11-17-g3-ds-live-retest-92981/README.md`。本计划是 F9 实测暴露的修复续篇，不改写旧文档成绩。

## Global Constraints

- 冻结36题分母/合同 SHA-256 `c3671cc8196ebcded7e0bd53a6fd7160593506b6aad04719a636b5becb050a6d` 不变；黄金合同不进 DS/构造器；不按题号输出坐标、不降低数学容差、不删除失败题。
- 保留用户确认前主画布零写入、候选 hash、CAS、证书保鲜、混合工具批次原子拒绝。探索态的 `accepted` 只能表示真实状态变化或返回可核对的只读证据；禁止“成功但没有执行”且不说明的假信号。
- 现修订 `0267dd61` 的付费 F9 仅测 GK-S08：8次请求、没有候选，**其他35题未测**；此外有3组不同参数的零费复现，不可说“多次DS实测”。本次计划/零费复测不发起新DS请求，真实平台费用仍未知。
- 所有真实模型复测需要固定新 revision、同版原生二进制、profile revision、输入来源、总请求/单题/token/费用上限与熔断。上一轮最多5美元/108次/单题8次下用了8次请求；**不自动认为剩余100次获准跨修订继续使用**，修复后先征询用户额度和范围。
- 每个任务必须 RED→验证失败→最小实现→定向 GREEN→反例/回归→进度文档与证据→提交推送，核对远端；只做文档不能声明 G3-F9 或产品发布已完成。

---

## 0. 真实失败图（已证实 vs 待查）

| 边界 | 本次证据 | 判定 | 位置 |
| --- | --- | --- | --- |
| 模型确实选择动作级工具 | 8次真实请求：`construct_solid → query_measurement → query_constraint_status → construct_face → add_relation ×3 → finish_candidate` | **已证实**，旧 `ds_intent` 误路由已纠正 | `apps/web/src/agent/modelPlanner.ts` / 原生 Tauri |
| `construct_solid` | 三种有效形状请求均 `ok:true/status:accepted/primitiveCount:0` | **已证实假成功**；当前仅拒绝手算 `vertices`，其余直接 accepted | `apps/web/src/agent/dsActionTools.ts` 的 `construct_solid` 分支 |
| `construct_face` | 三次 `accepted/0` | **已证实假成功**；落入尾部默认 accepted | `apps/web/src/agent/dsActionTools.ts` 末尾 |
| `finish_candidate` | 三次 `repairable/empty_candidate`；真实试点第8次调用后 `internal_budget` | **已证实**：前面没有 stage 几何动作 | `dsActionTools.ts` / `modelPlanner.ts` |
| `construct_base` / `construct_fold_state` | 从代码看未见专属几何执行分支、会落入尾部 accepted | **代码风险**，需用RED测试逐项证实 | `dsActionTools.ts` |
| `query_measurement` / `query_constraint_status` | 从代码看直接 accepted，不给 `measurement`/约束读数 | **代码风险**，须用RED测试确认模型无法看到真实状态 | `dsActionTools.ts` |
| F9多状态入口 | `runFrozenDsCase` 的 `PlannerPort` 路径仍从一份计划生成 `shared` slice；已有分支测试注入预制切片 | **已证实评测接线缺口**，不是模型几何失败 | `apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts` |

零费三组结果：`square_pyramid`、`triangular_prism`、`tetrahedron` 均 `construct_solid accepted/0 → construct_face accepted/0 → finish_candidate empty_candidate`，逐条保存在 [三组重复探针](../audit/2026-11-17-g3-f9-repeat-probe/README.md)。此处的 `accepted` 不仅误导模型，也使请求上限被无用工具消耗；不要把它解释成“DS 不会立体几何”。

## 1. 路线比较与推荐

| 路线 | 内容 | 适用性/代价 |
| --- | --- | --- |
| A. 先把未实现动作全部从模型工具表移除 | `construct_solid/face/base/fold_state` fail-closed 且不发布；其余二维动作继续工作 | **安全止血**，能立即消除假成功，但无法满足立体 18 题，不能当最终方案 |
| B. **复用现有约束内核接实动作（推荐）** | ActionSession 将参数化请求交 `solveConstraint3d` / 现有 `dsDrawingIntent` 构造器，产 `solid.create_polyhedron` / `solid.create_prism` / `solid.create_face`，统一走 `SpeculativeCanvas.applyAction`，读工具回真实测量 | 不新造第二套求解器；可按能力族交付、独立验证，可复用当前代码的数学反例 |
| C. 全量重写三维内核/引入外部求解器 | 换算法与实体模型 | 当前证据指向**执行工具未调用现有内核**，不是内核数值解质量差；先不做，只有B的真实求解失败被量化后另行 spike/许可证审查 |

选择 **A作为短期门禁 → B按立体构造族落地**；切忌只修改提示词、反复扩大重试上限或把 `accepted/0` 改名成 `partial` 却继续发下一请求。

## Task 0 — 工具状态真实性闸（修复假成功，先守住安全）

**Files:** Modify `apps/web/src/agent/dsActionTools.ts`, `apps/web/src/agent/dsActionTools.test.ts`; Extend `apps/web/src/agent/modelPlanner.test.ts`。不得改动已有用户确认/证书代码。

**Interfaces:** `DsActionExecutionResult` 保持现有 `{ok,status,action,candidateHash,stepIndex,primitiveCount,blockerCode?}`；构造动作只有调用 `speculative.applyAction` 成功且图元确实增加/发生可检查的实体变化才可返回 `accepted`；未实施动作返回 `ok:false,status:"blocked",blockerCode:"unsupported_action"`。元数据动作明确返回 `accepted` 但附 `stateChanged`，避免与“几何完成”混淆。

- [ ] RED：在 `dsActionTools.test.ts` 建立 `geometry3d` 的参数化三例，断言 `construct_solid`/`construct_face` 不得再出现 `accepted + primitiveCount=0` 且未报告阻断；`construct_base`/`construct_fold_state` 未落地前必须明确 `blocked/unsupported_action`。再断言 `finish_candidate` 前零动作必为 `empty_candidate`，不允许生成空 plan。运行 `npm.cmd exec -- vitest run apps/web/src/agent/dsActionTools.test.ts --testTimeout=30000`，确认新增用例 RED，既有二维正例仍绿。
- [ ] 最小实现：删除 `dsActionTools.ts` 的未知动作末尾 `return accepted`；未实现的3D动作先返回结构化拒绝；`buildDsActionToolSchemas` 暂时只发布**可执行**闭集，模型出现未发布动作仍按原始安全协议拒绝。具备真实 `applyAction` 后再逐项重新发布。`modelPlanner.ts` 在构造动作返回 `accepted` 但 `candidateHash/stepIndex/primitiveCount` 未变时记录 `no_progress` 并停，不消耗到8轮。
- [ ] GREEN：同一目标单测 + `apps/web/src/agent/modelPlanner.test.ts`；三组零费参数反例与二维两点一线正例都通过，确认零主画布写入。更新负面证据、状态并提交推送。**退出的是工具真实性，不是立体作图能力**。

## Task 1 — 参数化立体动作真正写入隔离候选

**Files:** Modify `apps/web/src/agent/dsActionTools.ts` 与 `.test.ts`; Refer only to existing `packages/agent-core/src/solver/constraintSolve3d.ts`, `packages/agent-core/src/dsDrawingIntent.ts`, `packages/agent-core/src/actionRegistry.ts` and `apps/web/src/agent/speculativeCanvas.ts`; only modify these modules if RED exposes concrete defect.

**Interfaces:** `construct_solid(input:{id,kind,sideLength?,height?,lateralEdge?,baseVertices?,topLabels?,edgeLengths?,sourceRefs?})` → `solveConstraint3d(request)` → if `status:"solved"` and topology/residual confirmed, map `vertices + faceRings + pointRegistry` into registered `solid.create_polyhedron` or `solid.create_prism` DraftAction → `speculative.applyAction` → `accepted` with increased primitiveCount/candidateHash; else `blocked/repairable` with `reason`, not an empty success. Match input `kind` to existing solver cases `regular_pyramid` / `prism` / `tetrahedron` / `perpendicular_pyramid`, not freeform `shape` aliases unless explicitly normalized; no arbitrary default side/height. Do **not** let DS supply raw vertices or contract gold coordinates.

- [ ] RED：四种 `kind` 各有一条有数学来源参数的合法输入；断言 `snapshot.actions` 含注册的真实3D动作且 `candidateHash` 改变、`primitiveCount>0`、`finish_candidate.terminated.plan.kind === "plan"`。断言缺边长/高、无解三角形、顶点命名冲突、坏面环、手算vertices、未声明的现有 host 均被拒且 `snapshot.actions.length===0`。先运行 `npm.cmd exec -- vitest run apps/web/src/agent/dsActionTools.test.ts packages/agent-core/src/solver/constraintSolve3d.test.ts --testTimeout=30000`，确认新增RED。
- [ ] 最小实现：仅复用 `solveConstraint3d` 和注册动作；按 `pointRegistry` 物化命名点/面，不自行重算一份DS坐标；`SpeculativeCanvas.applyAction` 返回失败原样作为 `repairable/blocked`，不绕过编译器/证书；未覆盖的立体族保持明确 `unsupported_action`。不把 test fixture 的答案作为参数默认值。
- [ ] GREEN：上述定向测试、`packages/agent-core/src/verification/drawingCertificate.test.ts`、`scripts/reliability-eval/solidContracts18.test.ts`、`npm.cmd run typecheck`；逐项验证候选图元、拓扑、长度和关键点名，不只检 `actions.length>0`。提交并推送此独立区块。

## Task 2 — 实际面/底座/折叠动作与观测工具

**Files:** Modify `apps/web/src/agent/dsActionTools.ts` / `.test.ts`; Modify `apps/web/src/agent/speculativeCanvas.ts` only if read-only candidate snapshot is missing a safe measurement interface; use existing `constraintSolve3d` / `foldChain` / `constraintGraph` / `geometry-kernel` readers.

**Interfaces:** `construct_face` 必须通过已物化的点名解析真实3D顶点，验证至少三点不共线、共面、唯一面环，调用 `solid.create_face` 并 `applyAction`。`construct_base` 按已验证的边长/角/拓扑生成实际底座而不是凭空置零；`construct_fold_state` 通过已有折叠状态谱系生成**另一版本候选**（hash不与折前复用）。`query_measurement` 返回具体被查询的长度/坐标及来源；`query_constraint_status` 返回 `satisfied/violated/unknown` 及 residual；如果只读尚未支持则 `blocked/unsupported_observation`，绝不返回空 accepted。

- [ ] RED：合法面三点生成 `solid.create_face` 且图元+1；缺点、三点共线、非共面四点、重复顶点不写入；底座缺参数、折后与折前 hash相同均拒绝；对合法已构造的 AB 查询返回实际距离、缺对象只读不伪报成功；约束状态有真实判据时才返回 satisfied。运行 `npm.cmd exec -- vitest run apps/web/src/agent/dsActionTools.test.ts apps/web/src/agent/speculativeCanvas.test.ts --testTimeout=30000`，新增RED。
- [ ] 最小实现：把会影响最终场景的每一步都走 `speculative.applyAction` 或候选状态派生 API，读取候选文档时只暴露只读受限快照；query 回执携带 `{status,value?,residual?,sourceEntityIds}` 而非正文快照；对未实现的观测保持阻断；rollback 后测量必须重算，不可读到已撤回的点。
- [ ] GREEN：目标测试与相关 `foldChain.test.ts`、`constraints3d` 测试通过；负例确认“错误图被拒”“状态不污染”“用户主画布零写入”。按可独立交付的子族分别同步文档并推送，不把底座/折叠未实现写成完成。

## Task 3 — 有界反馈和工具发布纪律

**Files:** Modify `apps/web/src/agent/modelPlanner.ts`、`apps/web/src/agent/dsActionTools.ts` 和两者测试； Modify `packages/agent-core/src/repairProgress.ts` only if current repair signature cannot express tool error.

**Interfaces:** `finish_candidate` 只有 `SpeculativeCanvas.snapshot().actions.length > 0` 且生产校验未拒时终止；工具回执记录 `{toolName,status,blockerCode?,candidateHash,primitiveCount,progressSignature}`。连续相同 `candidateHash + blockerCode + action` 不允许无进展重试到预算上限；模型每轮只见公开实现的工具。网络/代际预算与实际 HTTP 请求数都要串行扣账，8次/题只是硬顶，不是“应当用满”。

- [ ] RED：用零费伪模型连续调用 `construct_solid` 不合法参数3次，断言在第二次同签名时停止且请求数不大于2；用“第一次修正缺参数、第二次真实图元增加、第三次 finish”正例断言合法修复不被过早终止；混合读工具+构造批、重复callId、取消后迟到继续拒绝。运行 `npm.cmd exec -- vitest run apps/web/src/agent/modelPlanner.test.ts apps/web/src/agent/dsActionTools.test.ts --testTimeout=30000`，先RED。
- [ ] 最小实现：用现有 `repairProgress` 或本地同义签名区分真实进展，不使用模型自报的 `accepted`；工具清单按已实现能力过滤并与用户提示同源；外部单题/整批预算与内部代际预算不双扣导致伪“内部预算耗尽”，但不能让任何请求越过硬闸。
- [ ] GREEN：定向与 `apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts` 通过；记录被阻断调用前已有多少次真实请求，费用 usage 缺失记 unknown。提交推送。

## Task 4 — 真正 live 多问/多状态/多分支候选集合

**Files:** Modify `apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts` / `.test.ts`; Extend `scripts/reliability-eval/drawingContracts.test.ts`; only change `packages/agent-core/src/dsCandidateBundle.ts` if hash绑定用例RED证明需要。

**Interfaces:** `runFrozenDsCase(publicCase, provider, budget,{contract})` 的真实 `PlannerPort` 入口应从模型动作结果中读取 `scopeId/stateId/branchId`，生成各自 candidate/hash/证书并交 `evaluateFrozenCandidateSet`；不再固定为 `[{scopeId:"shared"}]`。冻结合同的 `requiredObligations/expected` **只在独立裁判侧可见**，提供给模型的只有原题及经用户确认的必要题图；无合法状态来源时保持 incomplete/failed，而不是拿已知标准分支替模型填空。

- [ ] RED：用按次返回的伪 DS 动作响应分别生成 GK-S02 折前/折后与 GK-P06 三分支的 **live-style** 候选集合；删除任一候选、交换 branch、两个状态复用同一 hash、只生成 `shared` 时整题失败；断言模型请求序列化不含 `requiredObligations`/`expected`。运行 `npm.cmd exec -- vitest run apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts scripts/reliability-eval/drawingContracts.test.ts --testTimeout=30000`，新增RED。
- [ ] 最小实现：只从模型自己提供的状态/分支意图、动作结果和公共题面映射 CandidateSliceArtifact；沿用已存在 `evaluateDrawingContractSetByPolicy` 聚合，不自己写第二套判题。不可行分支明确输出解释和证据而非造假图。
- [ ] GREEN：上述测试、`npm.cmd run typecheck`、回放上轮两种单候选报告显示分歧但**不改写**原0/36；新候选来源/hash/可读性绑定定向浏览器回归。提交推送。

## Task 5 — 同版真实画布、付费试点与最终门禁

**Files:** Extend `e2e/drawing-reliability-36-render.spec.ts`, `e2e/drawing-reliability-lifecycle.spec.ts`; Update `docs/current-status.md`, `docs/project-progress.md`, `docs/agent-next-round-progress.md`, `docs/acceptance/agent-tool-loop-scorecard.md`, `docs/acceptance/agent-release-gate.md` 与本审计目录。保留忽略目录原生请求日志，不提交原始模型/题干/密钥。

- [ ] 零费检查：Task 0–4 均按各自真实负例退出；至少一题结构化固化动作回放从 `construct_solid` 经 `finish_candidate` 生成候选图，`evaluateFrozenCandidateSet` 合同与证书一致；`npm.cmd run typecheck`、`npm.cmd run test:docs -- --testTimeout=30000`、定向/全量 Vitest、串行 Playwright `--workers=1 --retries=0`。非沙盒Windows实机和人工可读性仍单列。
- [ ] 重新授权真实费用：向用户明确询问修复后 revision / 固定题集 / 官方同模型价目表 / 单题请求数 / 整批请求数 / 美元上限 / 停止点。不能默认为“剩余100请求仍可用”；价格上界不是实际账单。缺任何一项时只跑0付费测试。
- [ ] 真实 DS 只测首题 GK-S08：实际调用 `ds_action` 且前置硬闸生效，必须报告动作执行与图元变动、完整合同、证书；若仍没有候选或生产证书失败立即停批，失败不换作 `legacy_actions` 顶数。达到单题通过后依次验证零候选立体、已有 partial、函数/圆锥、多状态/题图边界；每层通过且费用许可仍有效才扩36题。
- [ ] 最终退出只有全部冻结36题 DS 实际参与、完整合同、生产证书、同候选浏览器渲染、隔离交付全部通过；新题另报，人工/Windows实机发布签收单列。每个区块完成后脱敏取证、同步唯一实时状态、提交推送并核对远端。

## 自审 / 禁止的捷径

不要重跑当前修订再消耗DS额度；不要把零费三组复现写作“三次真实DS”；不要把 `construct_solid accepted/0` 解释为模型已学会立体；不要临时允许模型手输顶点绕过来源/拓扑；不要为了拿合同分数删减/放宽题设；不要让预造 CandidateSet 测试冒充 live 多状态；不要把 usage 乘当日官方价格推断为服务商真实扣款。
---

## 2026-11-18 增补：GK-S09 纯文字真实 DS 失败驱动修复（新 Task 6–9，均未实施）

> **可执行细化**：[GK-S09 详细修复实施计划](G3-F9-GK-S09-detailed-repair-plan.md)是 Task 6–9 的执行清单（文件职责、RED/GREEN、退出/回滚与授权门禁）；此处保留总览，避免出现两个独立实时状态。当前仍只有两次真实请求、无候选，35题未测。

> **优先级与事实边界**：旧 Task 0–5 的零费工程任务已经完成，但不自动关闭以下任务。当前真实证据是[GK-S09 单题试点](../audit/2026-11-17-g3-f9-text-only-pilot/README.md)：`89b00bcd`、`inputMode=text_only`、两次原生 `construct_solid`、没有候选、35题未运行。该报告**没有两次动作回执的 status、blockerCode、字段名或 hash 变化**；目前不能确定“模型给错参数”还是“现有内核拒绝”，更不能报告“F9 0/36”。此前 GK-S08 缺题图的澄清和旧立体动作 accepted/0 各是不同修订的历史问题，不得作为本题根因。

### 能力差距：先从题目需要的图像倒推，不从现有工具表倒推

GK-S09 的文字描述涉及**所有棱长同为符号 `a`、侧棱垂直底面、顶点共球面的三棱柱**。题目的作图至少要让 DS 输出命名棱柱和相应球体，并由内核检验顶点共球面；若给出答案/证明，还必须区分示意实例与任意 `a>0` 的符号结论。现有 `construct_solid` 在 `apps/web/src/agent/dsActionTools.ts` 中只接受部分 `kind` 的**正数尺寸**；`buildDsActionToolSchemas` 对工具参数仍是 `additionalProperties:true` 的通用对象，工具名称说明未给受支持 `kind`、必需字段和示例。`packages/agent-core/src/actionRegistry.ts` 虽有 `derived.create_circumsphere`，但动作级工具闭集没有对应构造出口。**这些是代码能力/接口差距，不证明它们就是两次请求的具体失败原因**；后者必须等 Task 6 的真实回执才能定责。尤其不能为了提高产图率静默把 `a` 代为某个数后声称已处理任意 `a`。

### Task 6 — 工具回执的可追责、最小化脱敏观测（第一优先，零付费）

**Files:** Modify `apps/web/src/agent/modelPlanner.ts`, `apps/web/src/agent/modelPlanner.test.ts`, `apps/web/src/agent/fixtures/g3DsCaseTrace.ts`, `apps/web/src/agent/fixtures/g3DsCaseTrace.test.ts`; Extend `apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts` if the live runner does not forward telemetry.

**Interface:** 对每一次 `dsActionSession.execute` 产生仅白名单字段的 `G3ActionReceiptTrace = {runId, requestIndex, toolName, resultStatus, blockerCode?, primitiveCountBefore, primitiveCountAfter, candidateHashChanged, stateChanged, feedbackDelivered}`。`requestIndex` 要绑定同一原生请求计数；不记 `toolCall.input`、题干、模型正文、具体尺寸/坐标、凭据或完整 `repairHint`。记录模型实际接收到的反馈类别，但不改变原有安全拒绝语义。若接线/记录失败，以 `telemetry_missing` 单列，不能把它记作成功或把旧 GK-S09 回执补写成猜测值。

- [ ] **RED**：注入一个缺 `height` 的 `construct_solid({kind:"triangular_prism"})`，要求 `resultStatus="repairable"`、`blockerCode="missing_required_parameter"`、图元数/hash不变且 `feedbackDelivered=true`；再用合法正数参数要求 `accepted`、图元增加、hash改变；对相同失败重复两次验证熔断信号。序列化测试必须拒绝 `prompt`、`toolInput`、`messages`、密钥字段和坐标/原始参数。Run: `npm.cmd exec -- vitest run apps/web/src/agent/modelPlanner.test.ts apps/web/src/agent/fixtures/g3DsCaseTrace.test.ts --testTimeout=30000`，新增断言先 RED。
- [ ] **GREEN**：仅在 `execute` 返回后、向模型送回执前生成白名单诊断，复用当前 `onStructuredDiagnostic`/trace 真源；分别验证 native tool、repairable、blocked、取消/预算停机和 usage 缺失路径。保持主画布0写入。对新代码**再经授权**复测 GK-S09 一题，取得真正 first-failure code；在此之前只报告“回执未记录”。

### Task 7 — 模型可见的工具契约与真正支持的立体族对齐（零付费）

**Files:** Modify `apps/web/src/agent/dsActionTools.ts`, `apps/web/src/agent/dsActionTools.test.ts`, `apps/web/src/agent/systemPrompt.ts`, `apps/web/src/agent/systemPrompt.test.ts`; `apps/web/src/agent/modelPlanner.ts` only if tool schema publication/phase selection needs changes.

**Interface:** `construct_solid` 按 `kind` 显示受支持的封闭参数族（当前至少 `regular_pyramid`, `perpendicular_pyramid`, `prism`/`triangular_prism`, `tetrahedron`；兼容别名由内核规范化），工具 schema 显式列每族必需字段、正数条件、顶点名/底面引用形式；模型提示和参数校验从**同一策略能力表**生成。对可能额外要求已存在画布点的族明确何时先 `construct_base`/`construct_point`。仍不允许原始 `vertices`；非公开字段不泄漏。不得通过通用 schema `additionalProperties:true` 让模型猜“合法”输入。若 provider 不支持复杂 union schema，应提供简单、经验证的分族工具，而不是仅在 prompt 中列出限制。

- [ ] **RED**：断言 `construct_solid` 工具 schema 能让模型看到 `kind` 枚举及各族必需字段；模型提交 `shape:"ball"`、无边长、错类型尺寸、未声明底面名，返回稳定字段路径与 `blockerCode`，且不创建候选；合法三棱柱参数通过现有 `solveConstraint3d`/`SpeculativeCanvas`。Run: `npm.cmd exec -- vitest run apps/web/src/agent/dsActionTools.test.ts apps/web/src/agent/systemPrompt.test.ts apps/web/src/agent/modelPlanner.test.ts --testTimeout=30000`，新增断言先 RED。
- [ ] **GREEN**：仅发布已实现的 `kind`/动作；将 `repairHint` 压缩成模型可执行的“缺哪一字段、可由哪条关系求得”，不回显题库预期图。保留 `hand_computed_vertices_forbidden`、混合工具批次拒绝、重复 callId 和证书边界。通过正负变体及已有二维/立体测试后独立提交。

### Task 8 — 符号尺寸与外接球：先定可验证图像语义，再补内核（零付费）

**Files:** Extend `packages/agent-core/src/solver/constraintSolve3d.ts` and `constraintSolve3d.test.ts` **only if** current solver cannot represent the selected parameterization; add a focused `packages/agent-core/src/solver/circumsphereFromSolid.ts` and `.test.ts` if existing `derived.create_circumsphere` cannot be reused; Modify `apps/web/src/agent/dsActionTools.ts` / `.test.ts`, `packages/agent-core/src/actionRegistry.ts` only for an actual registered action; Extend `scripts/reliability-eval/solidContracts18.test.ts` and `apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts`.

**Contract:** 先决策 `a>0` 的表现：**默认**生成明确标注的比例实例（如正规化 `a=1` 仅用作绘图尺度），同时保留符号 `a`、所有棱相等和顶点共球面的关系来源；证明或选项的数值结论仍须对任意 `a>0` 由代数推导或明确标为未证明，禁止把单实例当普遍结论。若题目要求动态参数，模型输出 `parameter:a`，内核绑定实例值后可随参数变更重算图、证书随 hash 失效。`construct_circumsphere({solidId,alias})` 从**已经构造的闭合棱柱**求球心与半径，复用 `derived.create_circumsphere` 的内核/动作，不收 DS 提供的球心半径。

- [ ] **RED**：合法三棱柱六个顶点均在派生球面上，三条底边与三条侧棱均为归一化尺寸 `a`；对 `a=1` 与另一个正值做比例变化，核对归一化关系和球面方程；只有三棱柱没有球体、假球体/错半径、非等棱、不可用符号、不同名称及退化/无解均失败。当前 `GK-S09` 合同要求命名立体与实际球体，只有 prism 不得算通过。Run: `npm.cmd exec -- vitest run packages/agent-core/src/solver/constraintSolve3d.test.ts packages/agent-core/src/verification/drawingCertificate.test.ts scripts/reliability-eval/solidContracts18.test.ts apps/web/src/agent/dsActionTools.test.ts --testTimeout=30000`；确认新增用例 RED。
- [ ] **最小实现**：只从内核算出球体与来源链，输出可追踪 `solidId`、球心/半径/证书输入 hash；为模型提供可执行的派生球动作、有效范例和无解反馈；不按 GK-S09 题号写坐标或选项，不向模型注入黄金答案。检查是否与已有 `derived.create_circumsphere` 重复，优先适配，不造第二套球算法。
- [ ] **GREEN**：`npm.cmd exec -- vitest run packages/agent-core/src/solver/constraintSolve3d.test.ts packages/agent-core/src/verification/drawingCertificate.test.ts scripts/reliability-eval/solidContracts18.test.ts apps/web/src/agent/dsActionTools.test.ts --testTimeout=30000`、`npm.cmd run typecheck`；零费录制 `ds_action` 从合法参数化三棱柱→派生球→`finish_candidate`→完整合同/生产证书均过，反例均拒。浏览器同候选截图再单独验收，不能以合同过代替画布可读性。

### Task 9 — 分层真实DS回归与止损（不得沿用本次旧请求）

**Files:** Add sanitized readme + per-case report to `docs/audit/g3-f9-next-live-retest/`; Update `docs/current-status.md`, `docs/project-progress.md`, `docs/agent-next-round-progress.md`, `docs/acceptance/agent-tool-loop-scorecard.md`, `docs/acceptance/agent-release-gate.md`。原生报告放 `eval-results/` 忽略目录。

- [ ] 固定 **Task 6–8 完成后的新修订**、题集 SHA-256、profile revision、确认题图/纯文字模式、官方价格与本轮请求/token/美元上限、首题失败停机门槛；明确取得用户**新付费授权**。旧两次 `construct_solid` 的实际 blocker 不能通过猜测回填；新回执含状态码才可判定是模型参数、不支持形状、场景依赖还是内核失败。
- [ ] 先只测 `GK-S09`，同版序列记录：模型被实际调用、动作参数字段形状、每步回执、立体与球体物化、全部约束残差、数学合同、生产证书、同候选浏览器画布、隔离交付。单题合同/证书未同时过立即停批；不能拿旧离线36/36补分子。
- [ ] 首题通过后，按题图完整性和能力族依次做立体另一题、平面曲线题、多问多状态、最终固定36题；每次扩批前更新预算且分母透明。对 `text_with_figure_reference` 题缺用户确认图像时允许澄清但仍计完整作图未通过。真实账单金额未知则写 `unknown`；人工可读性与Windows桌面窗口发布门禁仍独立。

### 审查重点：不要用“放宽防御”伪造提升

- `repairable` 只表示还可以探索，不等于“已画图”；所有数学关系、球体与拓扑在最终证书和独立合同继续 fail-closed。
- **能出图元不等于符合题意**：必须明确检验外接球、符号关系、多问和真实画布同版；缺一项仍失败。
- 同一种 `construct_solid` 再次失败若工具回执重复且 hash 不变，进入停滞熔断；不为“再测几次”自动增加花费。上一轮首题 GK-S09 的两次请求和本轮文档更新不构成下次额度。
