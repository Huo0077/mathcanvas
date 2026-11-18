# GK-S09 真实 DS 作图失败：F9 详细修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 每项以 `- [ ]` 标记；本文件为执行清单，不表示已经修复。

**Goal:** 让 DS 能从 GK-S09 的纯文字题面稳定生成题意所要求的命名等棱长直三棱柱、实际外接球及可核查的答案，并用真实候选的合同、证书、画布和受控交付验证，而非只产合法工具调用。

**Architecture:** 先记录动作级真实反馈，定位首次失败边界；将模型可见参数合同与内核接收契约统一；再为符号尺度提供受控示意实例和不依赖实例的数学不变量，并通过已有派生动作生成球。最后从零费用回放到新授权单题真实 DS，分层扩批。所有动作仍通过 `SpeculativeCanvas` 和现有证书/合同；不放松主画布确认、CAS、证书或原子拒绝。

**Tech Stack:** TypeScript、Vitest、现有 agent-core/scene-graph、Playwright、原生 Tauri DS 路径。

**Spec:** [F9 总计划](G3-F9-kernel-action-repair-plan.md) Task 6–9、[最终实施档案](G3-DS-final-implementation-dossier.md)及[GK-S09 单题实测](../audit/2026-11-17-g3-f9-text-only-pilot/README.md)。如有冲突，证据优先于猜测，当前实时状态以 [current-status](../current-status.md) 为准。

## 固定证据、边界与验收定义

- 固定题集哈希 `c3671cc8196ebcded7e0bd53a6fd7160593506b6aad04719a636b5becb050a6d`；旧真实请求 revision `89b00bcd6e8bed74389c8734499fc9efa3c13d65`。GK-S09 纯文字 `ds_action` **两次原生请求，两次选择 `construct_solid`，无候选**；具体输入字段和执行回执未记录，其他35题未测，实际账单未知。旧 GK-S08 缺题图澄清、旧版 accepted/0 均不是此两次请求的已证实原因。
- 当前 `buildDsActionToolSchemas` 为通用 `{type:"object", additionalProperties:true}`；`resolveConstructSolidRequest` 要求可解析的正数尺寸，缺失会给 `missing_required_parameter`，拒绝手算顶点。动作闭集未暴露外接球工具，虽然 `actionRegistry` 有 `derived.create_circumsphere`。这是**已核对的接口/能力风险，不是对旧两次回执的倒填**。
- 成功定义：DS 自己完成所需动作；同一 candidate hash 下有命名三棱柱与真正的球面；六顶点共球、三角底面三边及侧棱等长、侧棱垂直底面；符号一般性说明单列；独立合同、生产证书、真实浏览器可见渲染、隔离交付全部通过。单有图元、回答文字、离线录制或合法 JSON 均不算真实通过。
- 流水线：`题面 → 原生DS工具调用 → schema/解析 → dsActionSession.execute → 内核求解/暂存 → 模型看见回执 → finish_candidate → 独立合同/证书 → 同候选浏览器 → 用户确认/隔离交付`。每条记录保留 requestIndex/阶段/错误码，第一处未满足条件即停止，不能向后推断。

## 文件责任表

| 文件 | 单一职责及本计划改动 |
| --- | --- |
| `apps/web/src/agent/fixtures/g3DsCaseTrace.ts` / `.test.ts` | 只接受白名单脱敏的每动作回执；缺数据明示 telemetry_missing |
| `apps/web/src/agent/modelPlanner.ts` / `.test.ts` | 将原生请求序号、动作执行结果、送达模型的反馈类别连到同一 trace；预算/熔断不变 |
| `apps/web/src/agent/dsActionTools.ts` / `.test.ts` | 参数族单一真源、有效立体动作及衍生球接线；不得另造 solver |
| `apps/web/src/agent/systemPrompt.ts` / `.test.ts` | 从能力表给模型简明施工约束；不把冻结答案交给模型 |
| `packages/agent-core/src/actionRegistry.ts` 和证书/几何内核 | 优先复用派生球；只有 RED 证明现有动作不足时才做最小变更 |
| `scripts/reliability-eval/drawingContracts.test.ts` | 数学真值及替身球/退化体负例 |
| `apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts`、`e2e/drawing-reliability-36-render.spec.ts`、`e2e/drawing-reliability-lifecycle.spec.ts` | 整题录制回放、同候选浏览器与确认边界 |

## Task 6：真实动作回执，零费用，先定责

**产出接口（建议新增，实施时先核对现有诊断事件名）：**

```ts
type G3ActionReceiptTrace = {
  requestIndex: number; actionIndex: number; toolName: string;
  resultStatus: "accepted" | "repairable" | "blocked";
  blockerCode?: string; primitiveCountBefore: number; primitiveCountAfter: number;
  candidateHashChanged: boolean; stateChanged: boolean;
  feedbackDelivered: boolean;
};
```

- [ ] **RED** 在 `g3DsCaseTrace.test.ts`、`modelPlanner.test.ts` 使用伪 provider 依次返回 `construct_solid` 两种输入：`{kind:"triangular_prism",sideLength:1}`（缺 height）、`{kind:"triangular_prism",sideLength:1,height:1,vertexNames:["A","B","C","A1","B1","C1"]}`。第一条要求 `repairable/missing_required_parameter`、图元/hash不变且回执确实交给下一轮模型；第二条要求 accepted 且图元/hash改变。相同失败重复不得吞噬无进展熔断。缺 receipt 的合成轨迹要求 `telemetry_missing`，不能默认为 accepted。序列化注入 `prompt/toolInput/messages/authorization/sk-*` 必须拒绝或剔除，禁止记录尺寸和坐标。运行 `npm.cmd exec -- vitest run apps/web/src/agent/modelPlanner.test.ts apps/web/src/agent/fixtures/g3DsCaseTrace.test.ts --testTimeout=30000`；新断言预期先失败。
- [ ] **GREEN** 在 `dsActionSession.execute` 之后提取白名单状态；在现有 `onStructuredDiagnostic` 与 `G3CaseTrace` 中加 `actionReceipts` 并扩充 `assertSanitizedG3CaseTrace` 的深层白名单校验。记录前/后快照只能保留计数和布尔值，不保留 hash 原值或 raw input。`feedbackDelivered` 仅在现有工具结果确实加入下一轮消息后记 true；最后一轮没有反馈就记 false。原生请求索引来自 planner 的已有计数，单请求多动作递增 actionIndex。诊断丢失必须显式标记而非伪成功。
- [ ] 定向 GREEN 后核验取消、预算耗尽、blocked、repairable、usage 缺失，现有 no_progress 策略及确认前主画布0写入。运行 `npm.cmd run typecheck`、`npm.cmd run test:docs -- --testTimeout=30000`。独立复核 trace 的键集及与下一轮模型实际回执的一致性；如果该阶段仍无法获取 first-failure code，不开展付费重试。
- [ ] 记审计与进度；提交推送并核对远端。**不能追溯修复旧两次的缺失回执**：Task 6 只让后续调用可定责，不单独发 DS。

### Task 6 progress (2026-11-18)

- Code-only checkpoint: sanitized receipt type and deep validation, plus planner action events carrying request/action indices, status/blocker, primitive counts, state/hash changes, and feedback delivery. No raw prompts, coordinates or inputs are recorded.
- RED observed before implementation; targeted tests now show 80 passing and typecheck passes.
- 新增 `runFrozenDsCaseTraced` 原生 planner 运行器入口：记录逐请求动作回执、第一失败边界与终止回执；缺少动作事件时记录 `telemetry_missing`。旧 GK-S09 两次回执不能追溯，仍不能定责；未调用付费 DS。

## Task 7：工具 schema 与支持形状一一对应，零费用

**接口**：建议新增只读 `CONSTRUCT_SOLID_CAPABILITIES`，每族列 canonical kind、别名、required 字段、互斥替代字段、正数/名称约束，令解析器、schema 生成和 prompt 从同一表读取；必要的复杂几何校验仍由内核负责。不要把 symbol `a` 直接塞给 `asPositiveNumber`。

- [ ] **RED** 在 `dsActionTools.test.ts` 断言三棱柱示例 `{kind:"triangular_prism",sideLength:1,height:1,vertexNames:["A","B","C","A1","B1","C1"]}` 同时通过模型可见 schema 与执行；缺 height、负数边长、6顶点重名、非法 kind、传 `vertices` 分别在对应边界明确拒绝。对 `regular_pyramid/perpendicular_pyramid/prism/triangular_prism/tetrahedron` 逐族用一个有效和一个无效参数表驱动检查，且不允许 published 但无法执行。`systemPrompt.test.ts` 核对提示只列已支持族与尺寸规则。运行 `npm.cmd exec -- vitest run apps/web/src/agent/dsActionTools.test.ts apps/web/src/agent/systemPrompt.test.ts --testTimeout=30000`，先看新增 RED。
- [ ] **最小实现**：将 `buildDsActionToolSchemas` 的泛用 schema 改为严格、可被当前 provider 接受的结构；若供应商实测/协议验证不接受 `oneOf` 等复杂联合，改为 `construct_triangular_prism` 等分族外壳（每个工具先映射到现有 `construct_solid`，不新建求解器）。先用本地 provider mock/原生适配器协议测试确认工具名与 schema 原样送达；不得凭猜测宣称供应商支持联合 schema。输入规范化后依旧经 `resolveConstructSolidRequest` 和 `solveConstraint3d`，未知参数明确错误；已在场景中的点引用先查实体，不能默造。
- [ ] GREEN：上述定向、`npm.cmd run typecheck`、`npm.cmd run lint`，并跑有效族的反例回归；独立复核 schema→请求→内核的必填字段一致性，以及 `additionalProperties` 不再给模型错误自由度。失败则撤回工具发布而不是放宽形状校验。同步文档、提交推送。

### Task 7 family-tool checkpoint (2026-11-18, zero cost)

- A simple, closed `construct_equal_edge_triangular_prism` tool is now published for symbolic equal-edge right triangular prisms. Required fields: `id`, `displayScale`; optional `vertexNames` and slice identifiers. The action maps to the same `solveConstraint3d` and speculative canvas as `construct_solid`, with source validation and no hand vertices.
- The mock native provider actually receives the simple schema; the recorded product runner and exact-candidate browser test use this tool successfully. Provider-side acceptance has **not** been established without an authorized native request; do not mark the full remote schema gate complete.

## Task 8：符号 a、等棱长三棱柱、真正外接球

**数学与数据边界**：题设 `a>0`，示意归一化选择 `a_display=1` 仅为**绘图坐标系**；底边三段和高均采用同一尺度，展示物体以注记标示 `a`，绝不能写成从题面得到了 `a=1`。单位构型六顶点可为 `A=(0,0,0), B=(1,0,0), C=(1/2,√3/2,0)`、顶点对应平移 `z=1`；球心 `(1/2,√3/6,1/2)`，半径 `√(7/12)`，一般尺度为 `R=a√(7/12)`。使用参数族的不变量证明一般性，不从一个数值通过推出任意 a 的数学结论。

- [ ] **RED：参数来源** 在 `dsActionTools.test.ts` 添加题面符号输入实例，模型仅提交 `symbol:"a", displayScale:1, sideLength:1,height:1` 的情形可以作为图像实例，但必须在候选的可见元数据/证书解释中保留 symbol 与 `a>0` 假设和归一化来源；只有 `{sideLength:1,height:1}` 且无符号来源时不得声称任意 a 的证明。`a=0`、负数、不同底边/高、缺题面符号来源都拒绝“普遍结论”。实施前先查有无可复用参数来源字段；若没有，新增最小 provenance 记录并确保未确认前不进入主画布。
- [ ] **RED：独立物体** 测试调用合法 `construct_solid` 后应能通过新动作（建议 `construct_circumsphere({solidId:"prism",id:"sphere"})`）生成**真实 sphere** 并让六顶点到球心的距离残差都在现有几何容差内；不存在 solidId、退化或非共球顶点要 `blocked` 且快照/hash不变。参照 `drawingContracts.test.ts` GK-S09 正例及假 sphere/匿名替身负例。运行 `npm.cmd exec -- vitest run apps/web/src/agent/dsActionTools.test.ts scripts/reliability-eval/drawingContracts.test.ts --testTimeout=30000`，先看新增 RED。
- [ ] **最小实现**：复用 `packages/agent-core/src/actionRegistry.ts` 的 `derived.create_circumsphere`，经 `SpeculativeCanvas.applyAction` 暂存；动作响应包含实际图元数/hash变化，但球心半径由内核推导，模型不得手写球参数绕过来源。若派生动作只对特定实体类型可用，先加内核失败测试明确指出边界再做最小适配；不在工具层写第二套外接球求解。符号相关说明只作为独立、可溯源约束，不写进冻结合同标准答案给模型。提示词描述实例与普遍结论区别，不静默补缺参数。
- [ ] **GREEN** 运行 `npm.cmd exec -- vitest run apps/web/src/agent/dsActionTools.test.ts scripts/reliability-eval/drawingContracts.test.ts packages/agent-core/src/verification/drawingCertificate.test.ts --testTimeout=30000`、`npm.cmd run typecheck`；检查合同分别要求棱柱与球，数值缩放例如 `a_display=2` 时球心/半径同倍、退化拒绝、非共球拒绝、证书绑定同一候选。浏览器可读性另验。对无法派生球的内核缺陷以准确 blockerCode 停止，绝不画装饰性圆冒充球。同步进度、提交推送。

### Task 8 progress (2026-11-18)

- Implemented the action-level `construct_circumsphere` tool. It accepts only a staged solid reference and rejects center/radius injection, missing hosts, wrong workspace, unknown fields, and failed derivations atomically. It reuses `derived.create_circumsphere` and the existing scene-graph kernel.
- Implemented GK-S09 symbolic display handling: the actual frozen prompt can establish `a` from ?all edges equal a? without requiring a literal `a>0` phrase; `displayScale` is a positive drawing coordinate scale and is recorded as an assumption, never treated as the value of `a`. Unsupported symbol sources are blocked.
- Added zero-cost proof at display scales `1` and `2`: the same action chain (`construct_solid ? construct_circumsphere ? finish_candidate`) produces a genuine sphere, passes the independent GK-S09 contract and certificate, and preserves the symbolic result `7/3*pi*a^2`.
- Verification: targeted geometry/planner/certificate tests `183 passed`; documentation tests `22 passed`; full typecheck passed. No paid DS call was made. Browser same-candidate verification and a new authorized live DS run remain open.

### Task 6 receipt completeness addendum (2026-11-18)

Each real `ds_action` request is now checked against its action-call count. A zero-cost RED test proved that partial telemetry could previously be missed; `markMissingActionReceipts` now records `telemetry_missing`. The two historical GK-S09 receipts remain unrecoverable and are not backfilled.

## Task 9：录制整题回放 → 浏览器 → 新授权真实 DS → 分族扩批

- [ ] **RED：零费整题** 在 `g3DsFrozenCaseRunner.test.ts` 用按次回放的模型动作串（不是直接注入合格 CandidateSet）驱动 `construct_solid → construct_circumsphere → finish_candidate`；缺球、只文字、匿名替身、破坏等棱长、缺 finish、证书失败均断言整题未通过。冻结 `expected/requiredObligations` 只能传给独立裁判，不出现在 provider 请求。定向运行 `npm.cmd exec -- vitest run apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts scripts/reliability-eval/drawingContracts.test.ts --testTimeout=30000`，确认 RED 后完成接线再 GREEN。
- [ ] **同候选链** 保留真实候选 hash 和证书关联，在 `e2e/drawing-reliability-36-render.spec.ts` 与 `e2e/drawing-reliability-lifecycle.spec.ts` 验证球体和棱柱在同一浏览器候选可见、候选变更导致证书失效、用户确认前主画布0写入、隔离提交后才出现受控写入。运行 `npm.cmd exec -- playwright test e2e/drawing-reliability-36-render.spec.ts e2e/drawing-reliability-lifecycle.spec.ts --workers=1 --retries=0`；真实桌面窗口和教师人工可读性分别保持待签收。
- [ ] **全量零费门禁** 运行 `npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:docs -- --testTimeout=30000`、`npm.cmd test`，原失败族及所有相关定向用例不得退化；复核生产证书、条件确认、CAS 和批量拒绝仍有效。录制结果须标为 `modelInvoked:false` 或 `recorded_replay`，绝不算真实 DS 成绩。
- [ ] **新授权单题** 冻结新 revision、原生二进制/profile revision、题集哈希、输入来源、模型标识、可核对的官方价目、最大输入输出 tokens、单题请求数、总请求数、美元上限与停机阈值；向用户索取**新的明确付费授权**。旧“5美元/108请求”不能自动滚动使用。若花费缺真实账单仅记 `unknown`，预算上界不当实际支出。先只测 GK-S09：记录逐请求动作与白名单回执、球/棱柱、合同、证书、浏览器和交付；首次失败、telemetry_missing、超预算或任一结果缺失即停。
- [ ] **扩批决策** 仅首题完整通过并获得所需范围授权后依次测另一立体、二维曲线、多状态/多分支、缺图题的图像输入门槛、最后固定36题；每批都明确已测分母、通过数、partial/失败数、费用未知项及同版 revision。题图缺失只能请求澄清且作图记未通过。目标100%是验收方向，**不能承诺保证DS每次都100%**，需重复真实测量稳定性和失败类型才考虑发布。
- [ ] 每个区块独立审阅、更新 `docs/current-status.md`、`docs/project-progress.md`、`docs/agent-next-round-progress.md`、`docs/acceptance/agent-tool-loop-scorecard.md` 和 `docs/acceptance/agent-release-gate.md`，归档脱敏证据，`git diff --check` 后单独提交并推送当前分支；核对远端 ahead/behind = `0/0`。失败或回归时只回滚该区块的功能变更，保留负面证据、冻结合同和主画布安全门禁。

### Task 9 exact-candidate browser gate (2026-11-18, zero cost)

The earlier 41 browser tests used a different deterministic planner, so they did not prove rendering of the DS action candidate. A dedicated Playwright test now exports the *recorded ds_action* GK-S09 candidate only after its independent contract and certificate pass; imports the same normalized document into the real browser; and checks equal candidate/document hashes, prism, sphere, six labels, and visibility. Import normalization via `createDefaultCadLayout` is necessary: the browser otherwise inserts layers/sheets and changes the semantic hash. This check is not native DS participation, nor an isolated candidate confirmation/commit test.

### Task 9 product-route gate (2026-11-18, zero cost)

A RED test with the actual frozen GK-S09 prompt showed that `createAgentRunner({ modelPlanner: { intentMode: "ds_action" } })` called the provider zero times because `routeDeterministicProblem` preempted the model. Explicit ds_action opt-in now bypasses only that shortcut. A recorded provider calls the product coordinator three times, stages prism + derived sphere with zero main-canvas writes before confirmation, then commits once on confirmation. Default UI routing remains deterministic or legacy and no paid DS result is implied.

### Task 7 symbolic-input hardening (2026-11-18, zero cost)

For a prompt stating that all prism edges equal symbolic `a`, an unlabelled numeric `sideLength`/`height` is now blocked with `symbol_source_required`. The model must send `symbol:"a"` and positive `displayScale`, which is recorded as a display assumption rather than a value for `a`. Product ds_action and recorded replay regressions cover both legal and illegal inputs.

## 不可偷换的出口

Task 6 只解决“知道为什么失败”；Task 7 只解决“模型知道怎么调用”；Task 8 只解决“内核能产生真球/符号表达”；Task 9 的录制成功只解决“链路可用”。**只有新的真实 DS 请求 + 同版候选的全合同/证书/画布/交付共同通过，才能记 GK-S09 实测通过**。35题仍未测；不得以某一个阶段的 GREEN 更新真实36题成功率。
