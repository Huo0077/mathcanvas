# P1 / T02 单一 ProblemContract、来源映射、作用域隔离与无损 ObligationIR 迁移证据

日期：2026-11-16  
分支：`feature/drawing-reliability-execution`

## 1. 任务目标与前置约束

按 [任务台账](../../superpowers/plans/2026-11-15-implementation-task-ledger.json) 与 [实施手册](../../superpowers/plans/2026-11-15-drawing-reliability-execution-handbook.md) 执行 `B4 / P1 / T02`（依赖 `T01`、`R01`）：

1. 保留原文精确 UTF-16 `sourceSpan` 与 `documentHash`，在 LaTeX 展开（`\angle` / `A_1` / `^{\circ}` / `\frac` / `\sqrt` 等）、多字节与代理对 Unicode 字符（如 `𝔭`）以及重复从句下精准映回原题切片，禁止仅用 `indexOf` 命中首处。
2. 保留公共与分问作用域（`shared` / `subquestion:N`），消除跨问污染、clause-initial `证明` / 目标句被误当题设前提、`任取一点` 或模型建议参数（如 `a=2`）被私自升级为原题硬前提的问题；同时收口 `R01-B` 完整选问（支持显式选择 `selectedPart` / `selectedScopeId`）。
3. `toLegacyObligationSet(ir)` 无损还原 `parts` 与当前作用域选择，兼容全部既有 `ObligationIR` 调用点（且在不开启 subquestion 作用域的旧单问路径上保持逐字节 JSON 兼容，不破坏 R6 / off-path 黄金基线）。
4. 统一正字与跨状态实体身份：`A1` ↔ `A₁` 在同一 `(scopeId, stateId)` 合并别名；翻折前 `D@s0` 与翻折后 `P@s1` / `D@s1` 严格分离，未指明状态查询同显示名跨 state 实体时显式返回 `ambiguous`，绝不静默混用坐标。
5. 未解析或不可判定的必要条件继续保留在 `unverified` 与 `coverage.unresolvedSource` 中，改题自动判旧合同失效（`isContractStale`），手工旧合同缺来源时不伪造完整证书。

## 2. RED → GREEN 演进记录

- **RED 阶段**（先写测试并运行 Vitest 确认失败）：
  - 新建 [`problemContract.test.ts`](../../../packages/agent-core/src/problemContract.test.ts)，新增 RED 用例至 [`obligationIR.test.ts`](../../../packages/agent-core/src/obligationIR.test.ts) 与 [`promptNormalization.test.ts`](../../../packages/agent-core/src/promptNormalization.test.ts)。
  - 运行 `vitest run obligationIR.test.ts promptNormalization.test.ts problemContract.test.ts`：
    - `problemContract.test.ts` 因模块尚未存在失败；
    - `obligationIR.test.ts` 14 项中 2 项失败：`toLegacyObligationSet(parsed.ir).parts` 返回 `undefined`，以及 `{ selectedPart: 2 }` 返回 `["PA=2"]` 缺失 `"AD⊥DC"`；
    - `promptNormalization.test.ts` 23 项中 1 项失败：`application.sourceMap` 为 `undefined`。
- **关键改动（GREEN）**：
  - [`numberedProblem.ts`](../../../packages/agent-core/src/numberedProblem.ts)：新增 `SHARED_SCOPE_ID`、`subquestionScopeId`、`parseSubquestionScopeId`，并允许中文冒号 `：`/`:` 引导的小问编号拆分。
  - [`latexNormalisation.ts`](../../../packages/agent-core/src/latexNormalisation.ts)：新增 `normalizeGeometryPromptWithSourceMap` 与 `mapNormalizedRangeToOriginal`，为 LaTeX/OCR/简写/空白归一维护逐 UTF-16 `SourceMapSegment`；`normalizeGeometryPrompt` 直接复用同一映射输出。
  - [`promptNormalization.ts`](../../../packages/agent-core/src/promptNormalization.ts)：在 `NormalisationApplication` 输出精确的 `sourceMap`（`mapEditedRangeToOriginal`），并在 `parseNormalisationReply` 拦截目标混入已知条件、自由点降级及篡改小问编号的改写。
  - [`diagramObligations.ts`](../../../packages/agent-core/src/diagramObligations.ts)：修正第 (1) 问含前提时的 `needsScopedVerification` 检查与从 `part.start` 起算的 `parseDiagramScope` 目标边界；补全 `R01-B` `selectedPart` / `selectedScopeId` 选问隔离（含仅 `shared` 与非法问号 fail-closed 保护）；支持 `"任取一点P"` 自由点提取。
  - [`claimEvidence.ts`](../../../packages/agent-core/src/claimEvidence.ts) & [`obligationIR.ts`](../../../packages/agent-core/src/obligationIR.ts)：新增 `scopeId` / `stateId` 与 `ObligationScope`，在不破坏单问 off-path 黄金 JSON 契约的前提下实现多问 `parts`、`selectedScopeId`、`goalSources`、`freeChoiceSources` 与 `unverified` 的无损双向适配。
  - [`problemContract.ts`](../../../packages/agent-core/src/problemContract.ts) & [`index.ts`](../../../packages/agent-core/src/index.ts)：新增统一契约适配层 `buildProblemContract`、`resolveEntityBinding`（规范别名归并与跨折状态歧义检测）、`recordModelProposal`（拒绝无推导来源的 `a=2` 等参数升级为硬前提）与 `isContractStale`。
  - [`planCompiler.ts`](../../../packages/agent-core/src/planCompiler.ts) & [`planCompiler.subquestionCoverage.test.ts`](../../../packages/agent-core/src/planCompiler.subquestionCoverage.test.ts)：打通 `PlanCompileContext.selectedSubquestion` / `selectedScopeId` 选问接线，新增端到端 (1) 通过 / (2) 实测失败用例。

## 3. 验证结果

- 定向与黄金回归：`obligationIR.test.ts`（14 passed）、`promptNormalization.test.ts`（23 passed）、`problemContract.test.ts`（7 passed）、`planCompiler.subquestionCoverage.test.ts`（9 passed）、`planCompiler.offPath.golden.test.ts`（13 passed）全部通过。
- 全量包测试：`npm.cmd test -- --testTimeout=30000`：**527 文件 / 5611 passed | 1 todo**。
- 类型检查与代码检查：`npm.cmd run typecheck`（0 errors）、`npm.cmd run lint`（0 errors / 32 既有 warning）。
- 构建与离线评测：`npm.cmd run --workspace @draw/web build`（635 modules）、`npm.cmd run eval:reliability -- --offline`（3 passed）、`npm.cmd run test:docs -- --testTimeout=30000` 均通过。
