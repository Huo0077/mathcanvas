# G3 Task 4：18 道立体 / 折叠数学合同收口与 G3-Math 36/36 总门禁退出证据

- **日期**：2026-11-17
- **代码基准**：`2e0772ba`（Task 3 平面 18 题闭环）+ Task 4（18 道立体/折叠确定性求解、开放曲面 DSL/compiler 支持、`solidVolume`/`dihedral` 核验与 G3-Math 36/36 全链路闭环）

## 一、核心工程改动

1. **开放曲面（Open Surface）端到端契约打通（`GK-S02`、`JT-S08`）**
   - `packages/dsl/src/schema.ts`、`packages/scene-graph/src/actions/{types,index}.ts`、`packages/agent-core/src/{actionRegistry,actionInputs}.ts` 为 `solid.create_polyhedron` 与 `polyhedron3` 图元新增可选布尔标记 `open`（`open === true` 时走 `buildOpenSurface` 至少 2 个面环 / 5 条棱；缺省或 `false` 仍严格保持闭合 2-流形 ≥4 面 / ≥6 棱及定向体积校验，不放宽闭合体不变量）。
2. **复合点标完整性修复与球体标签透传**
   - `scripts/reliability-eval/drawingContracts.ts`（`inspectPointAndPrimitiveIntegrity`）：保留形如 `solid-1:v0` / `solid-1:p0` 的完整内部顶点别名以消除所有三维立体/棱柱因按 `:` 截断导致的假重复标签冲突，同时严格保留对人工同名标签、非 `:(v|p)N` 别名及 2D/3D 错维点的拦截。
   - `packages/agent-core/src/actionInputs.ts`（`solid.create_sphere`）：补齐可选 `label` 字段解析（`boundedString`），确保命名球体（如 `JT-S01 (1)(ii)` 的球 `O`）通过唯一实体检查。
3. **体积/余弦二面角核验与多状态 / 多作用域路由贯通**
   - `packages/agent-core/src/{obligationIR,diagramObligations,diagramVerification}.ts`：新增 `solidVolume`（三棱柱 `det/2`、三棱锥/四面体 `det/6`）与带分式根号解析的 `dihedral` 余弦条件；将 `将矩形…翻折至与梯形…垂直` 置于通用矩形规则之前以避免范围重叠吞并 `planePerpendicular`；扩展 `parseDiagramScope` 处理 `(2) 求…` 与选择填空 `则…（）`。
   - `packages/agent-core/src/deterministicProblemRoute.ts`、`scopedPyramidPlan.ts`、`solidDrawingPlan.ts` 与 `apps/web/src/agent/fixtures/reliabilityEval.eval.test.ts`：新增 `scopePlans`、`statePlans`、`scopedStatePlans` 与全部 17 组立体/折叠参数化构造方法，贯通 `GK-S01..09` 与 `JT-S01..09`。

## 二、验证清单（最后一次代码编辑后全部退出 0）

- `scripts/reliability-eval/solidContracts18.test.ts`：**23/23 passed**（`GK-S01..09` + `JT-S01..09` 全 18 题确定性构造 + `diagramVerification` + `DrawingCertificateResult` + `evaluateDrawingContract*` 全部通过；另含 4 项负向篡改反例：`GK-S02` 破坏刚体翻折顶点 `P`、`JT-S04` 第 `(2)` 问错代 `BE=5`、`JT-S09` 错改半球半径、`GK-S05` 篡改棱上点 `B₂` 偏移，均被独立合同稳定拒绝）。
- `scripts/reliability-eval/planarContracts18.test.ts`：**23/23 passed**；`scripts/reliability-eval/drawingContracts.test.ts`：**45/45 passed**；`packages/agent-core/src/diagramObligations.test.ts`：**109/109 passed**。
- `npm run eval:reliability -- --offline`（报告 `eval-results/reliability/offline-2026-11-17T00-04-56.105Z-34440`）：`reliability-dev-smoke` **31/31 passed**（`denominator: 31, ran: 31, passed: 31, firstAttemptPassed: 31, incomplete: 0`）。
- `npm run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`（报告 `eval-results/reliability/offline-2026-11-17T00-05-11.397Z-48432`）：`drawing-contracts-36` **36/36 passed**（`denominator: 36, ran: 36, passed: 36, partial: 0, failed: 0, incomplete: 0, firstAttemptPassed: 36, meanObjectCoverage: 1, meanObligationCoverage: 1`，全部 36 份 `case-*.json` 实测 `passed: true`、`liveWrites: 0`、`drawingCertificateStatus: "passed"`、`verificationStatus: "passed"`）。
- `npm run typecheck`：exit 0；`npm run lint`：exit 0（0 errors）；`npm --workspace @draw/web run build`：exit 0（`built in 23.77s`）。
- `npm test -- --testTimeout=30000`：**543 passed (543) | 5793 passed | 1 todo (5794)**（exit 0）。
- `npm run test:rust`：**exit 0**（`mathcanvas_desktop_lib` 14 passed、`conversations` 26 passed、`project_repository` 27 passed、`bundles`/attachment 41 passed、`run_events` 10 passed、`secrets` 11 passed / 1 ignored [Windows Credential Manager manual test]、`shell_smoke` 9 passed）。

## 三、只读独立数学与合同复核结论

- 独立只读审查（subagent `Independent Contract Reviewer`）完成对 `solidDrawingPlan.ts`、`scopedPyramidPlan.ts`、`deterministicProblemRoute.ts`、`drawingContracts.ts`、`schema.ts`、`actionInputs.ts`、`diagramObligations.ts`、`diagramVerification.ts`、`obligationIR.ts` 与 `offline-2026-11-17T00-05-11.397Z-48432/summary.json` 的逐项核对，并实跑 `drawingContracts.test.ts` + `diagramObligations.test.ts` + `solidContracts18.test.ts`（**177/177 passed**）。
- **结论：`SOUND (PASS)`**：无题号分支/特判，闭合与开放拓扑不变量均未放宽，36/36 合同全部由独立几何与拓扑判据在 `liveWrites = 0` 下通过。
- **诚实记录非阻塞附注**：部分构造器向产品 `verifyDiagramObligations` 传入标准化 `diagramPrompt`（不影响 `drawingContracts.ts` 对 frozen 36 题全量原合同的独立回代）；少数立体分支匹配尚未全参数泛化 `∠BAD` 等常量角。

## 四、当前边界

- **`G3-Math` 已正式退出（36/36）**；但 **`G3-UX` 与 G3 总验收尚未退出**（下一步立即推进 Task 6 `T16` 浏览器生命周期 E2E + Windows 桌面 `no-bundle` 实测 + 用户已授权保存的 DeepSeek 实测，以及 Task 7 总门禁核验与人工可读性签收口径对齐）。
