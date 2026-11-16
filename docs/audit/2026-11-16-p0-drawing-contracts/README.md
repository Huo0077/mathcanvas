# P0 / T01 —— 36 题黄金作图契约冻结与统一评测口径证据

- **日期**：2026-11-16
- **区块**：`B4 / P0 / T01`（前置 G1/G2 已收口于 `d7e1e3af`）
- **状态**：`T01` 实现与离线/回放验证已落地；`drawing-contracts-36.json` 独立复核状态显式标注为 `pending_second_reviewer`（待第二位独立审阅者复核后方能宣告 `P0` 阶段整体退出）。

## 交付内容

1. **36 题冻结黄金作图契约（`test-fixtures/reliability/drawing-contracts-36.json`）**
   - 从只读基线原件 [`docs/audit/2026-11-15-drawing-baseline/manifest.json`](../2026-11-15-drawing-baseline/manifest.json) 逐字对齐 36 道真题（`GK-S01..GK-S09`、`JT-S01..JT-S09`、`GK-P01..GK-P09`、`JT-P01..JT-P09`），固定分母 `denominator = 36`。
   - 每条契约均独立求解并标注 `inputHash`/`sourceHash`（UTF-8 SHA-256）、`inputMode`、`sharedScope`、`subquestions`、`requiredEntityIds`、`requiredObligations`（带逐字偏移 `sourceSpan: { text, start, end }`）、`displayPolicy`、`freeChoices`、`unsupportedReasons` 与 `independentReviewStatus: "pending_second_reviewer"`。
   - 修补基线局部 oracle 漏洞（包括 `JT-P08` 增加向量关系 `C - E = 2(F - C)` 校验防止仅点在椭圆上误判为 exact；`GK-S05 (2)` 与 `JT-P06 (2)` 显式标注不可行分支契约，禁止静默删问或伪造满足点）。
2. **契约校验器、反例回归与基线重建（`scripts/reliability-eval/drawingContracts.ts`、`scripts/reliability-eval/drawingContracts.test.ts`）**
   - 实现无 Node 依赖的核心契约校验、独立几何回代评估（覆盖 2D/3D 点、距离、垂直、平行、角度、比例、点积、面积、体积、圆锥曲线、函数采样、共线、`vector-ratio-2d` 与 `infeasible-branch`）及固定分母汇总器。
   - `drawingContracts.test.ts` 验证：`manifest.json` 36 题哈希与 `sourceSpan` 精确匹配、篡改题干不改哈希拒收、缩减分母 `< 36` 拒收、`GK-S02` 缺 `E/F/P` 失败、`JT-P08` `E(2,0),F(0,√3)` 误判反例被捕获、`JT-P06` 伪造 `P` 拒收且如实披露不可行通过、`incomplete` 与 `partial` 不缩分母且不计为 `passed`，以及基线保存档案精确重建（`denominator: 36`、`previewProduced: 25`、`legacyHostPassed: 4`、`certificatePassed: null`、`partialOracleExact: 8`）。
3. **统一评测入口与报告架构（`scripts/reliability-eval/runner.mjs`、`scripts/reliability-eval/runner.d.mts`、`apps/web/src/agent/fixtures/reliabilityEval.eval.test.ts`）**
   - `reliabilityEval.eval.test.ts` 输出 `reliability-summary.v2` 与 `reliability-contract-summary.v1`，记录固定分母、`objectCoverage`、`obligationCoverage`、失败分桶（`math` / `visual` / `interaction` / `partial` / `unknown` / `incomplete`）、`requests`、`tokens`、`costUsd: null` 与 `costKnown: false`，`liveWrites` 硬断言为 `0`。

## 验证证据（本区块完成后实测）

- `npx vitest run scripts/reliability-eval/drawingContracts.test.ts scripts/reliability-eval/finalOutcome.test.ts --testTimeout=30000`：`2 files / 12 passed`（`drawingContracts.test.ts` 先 RED 导入失败后转 GREEN `8 passed`）。
- `npm.cmd run eval:reliability -- --offline`（默认 `dev-smoke.json`）：`3 passed`（`liveWrites === 0`、`costKnown === false`）。
- `npm.cmd run eval:reliability -- --replay <dev-smoke replay.json>`：`3 passed`。
- `npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`：`3 passed`，统一报告统计 `denominator: 36`、`ran: 36`、`passed: 1`（`GK-S01`）、`partial: 2`、`failed: 33`（`interaction: 33`）、`incomplete: 0`、`requests: 36`、`liveWrites: 0`、`costUsd: null`、`costKnown: false`。
- `npm.cmd run typecheck`、`npm.cmd run lint`（`0 errors`，32 既有未改动文件 warning）、`npm.cmd run --workspace @draw/web build`（`634 modules`）全部通过。
- `npm.cmd test -- --testTimeout=30000` 全量 Vitest：**526 files / 5600 passed | 1 todo**；`npm.cmd run test:docs -- --testTimeout=30000`：**8 files / 22 passed**。
- 本轮未调用任何付费真实 provider（`--allow-paid` 未触发），原 `docs/audit/2026-11-15-drawing-baseline/` 文件未作任何改动。
