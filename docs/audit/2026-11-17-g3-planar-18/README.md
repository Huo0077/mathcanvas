# G3 Task 3：18 道平面 / 圆锥曲线 / 函数作图数学合同全闭环

- **日期**：2026-11-17
- **代码基准**：`3e7a0dce`（Task 2 完整证书接线）+ Task 3（18 道平面/圆锥曲线/函数确定性求解、DSL/验证增强与协调器全链路闭环）

## 一、核心工程改动

1. **`excludedPoints` 端到端链路（`JT-P08` 挖去顶点 `conic-domain-2d`）**
   - `packages/dsl/src/types.ts`、`packages/scene-graph/src/actions/{types,index}.ts`、`packages/agent-core/src/{actionRegistry,actionInputs}.ts` 为 `planar.create_conic`（椭圆/双曲线）新增并登记 `excludedPoints`（`FIELD_KINDS: "pointList"`）透传至编译图元。
2. **Scoped scope / branch / infeasible 全链路透传与评估**
   - `packages/agent-core/src/verification/drawingCertificate.ts`、`coordinatorPorts.ts`、`coordinator.ts`、`committerAdapter.ts`、`apps/web/src/agent/{agentRunner,draftStore}.ts` 与 `apps/web/src/agent/fixtures/reliabilityEval.eval.test.ts` 贯通 `selectedScopeId`（含 `compileInProcess`、`parseObligationWithLegacy`、`verifyDiagramObligations` 与 `certifyDrawingAgainstContract`）以及 `evaluateDrawingContractBranches`（多分支枚举 `GK-P06` / `JT-P08`）和 `infeasibleDiagnosedSubquestions`。
3. **几何内核与义务/核验增强**
   - `packages/geometry-kernel/src/conic-parameters.ts` 支持 `pointOnCurve` 线性系统求参（1 点 + 焦距 `JT-P06`、过原点两定点 `JT-P05`）。
   - `packages/geometry-kernel/src/function-evidence.ts`（`verifyTangentLine`）同时搜寻 `derivZeros ∪ valueZeros ∪ domain` 并以符号导数优先校准值残差与斜率残差，既覆盖拐点偶重根切线（`GK-P09` 在 `x=1` 处切于 `x⁴−2x³`）又不把割线（如 `y=9x`）误判为切线。
   - `packages/agent-core/src/{claimEvidence,obligationIR,diagramObligations,diagramVerification}.ts` 新增 `collinear` / `pointLineCoord`、`domain.conicKind` 消歧、`signedRadicalOrFraction`（支持前导 `+` 而不吞句子末尾句号）、隐式抛物线/圆切线条件与 `resolveFocusEccentricity` 显式方程去重保护。
4. **确定性平面与函数构造器**
   - `packages/agent-core/src/solver/functionDrawingPlan.ts`（基于内核符号求导与公切线反解支持 `GK-P04` / `GK-P09`）与 `packages/agent-core/src/solver/planarDrawing.ts`（`GK-P01..03, 05..08`、`JT-P01..09`，修复 locus 圆 `"M"` 双实例冲突）接入 `routeDeterministicProblem`。

## 二、验证清单（最后一次编辑后全部退出 0）

- `scripts/reliability-eval/planarContracts18.test.ts`：**23/23 passed**（`GK-P01..09` 与 `JT-P01..09` 全 18 题确定性构造 + `diagramVerification` + `DrawingCertificateResult` + 合同/分支评测全部通过；另含 4 项负向篡改反例：篡改 `GK-P01` 弦端点破坏共线、`GK-P05` 点 `P` 脱离 `x=1`、移除 `JT-P08` `excludedPoints`、篡改 `GK-P09` 切点横坐标，均被编译/核验或合同门禁稳定拒绝）。
- `packages/agent-core/src/diagramObligations.test.ts`：**109/109 passed**；`packages/geometry-kernel/src/function-evidence.test.ts`：**24/24 passed**；`actionSchemas.test.ts`：**22/22 passed**；`conicFromFocusEccentricity.test.ts`：**11/11 passed**；`commonTangent.product.test.ts`：**7/7 passed**；`actions.families.test.ts`：**27/27 passed**。
- `npm run typecheck`：exit 0；`npm run lint`：exit 0（0 errors）；`npm --workspace @draw/web run build`：exit 0（`built in 23.58s`）。
- `npm run eval:reliability -- --offline`（报告 `eval-results/reliability/offline-2026-11-16T19-01-21.101Z-45448`）：**3/3 passed**（exit 0）。
- `npm run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`（报告 `eval-results/reliability/offline-2026-11-16T19-01-36.001Z-49992`）：**18/18 平面题经协调器 + `DraftStore` + 完整证书门全部通过**（逐题 `passed: true`、`liveWrites: 0`、`drawingCertificateStatus: "passed"`、`verificationStatus: "passed"`；36 题全表暂为 `18 passed / 2 partial / 16 failed / 0 incomplete`，对象覆盖率 `54.17%`，义务覆盖率 `52.31%`）。
- `npm test -- --testTimeout=30000`：**542 passed (542) | 5770 passed | 1 todo (5771)**（exit 0）。

## 三、当前边界

- 18 道平面题数学合同已全面收口，但 18 道立体几何与折叠题尚未在 Task 4 闭环，**`G3-Math` 尚未退出**；下一步立即进入 Task 4（立体/折叠 18 题与 `G3-Math` 36/36 总门禁）。
