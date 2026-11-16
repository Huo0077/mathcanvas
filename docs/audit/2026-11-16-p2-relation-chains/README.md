# P2 / T03 关系语义分离与完整角链证据（2026-11-16）

> **任务合同**：`docs/superpowers/plans/2026-11-15-implementation-task-ledger.json` -> `T03` (`fix(parser): separate incidence from ratios and preserve angle chains`)。

## 1. 纠偏范围与领域修正说明

1. **裸长度比与点在线段位置解耦**：
   - `packages/agent-core/src/lengthEquality.ts`（`relationsOf`）与 `packages/agent-core/src/diagramObligations.ts`（倍数比读取器及移除末尾 `sizedSegments` 覆盖补丁）不再把无锚点的共享端点比（如 `DE=2EA`、`AB=2BC`）标成 `splitPoint: true`。所有词法/关系解析器产生的 `segmentRatio` 统一为 `splitPoint: false`。
   - `packages/agent-core/src/diagramVerification.ts`（`segmentRatio` 分支）收紧为 `sharedMiddle && item.splitPoint === true`，使裸 `DE=2EA` 与未显式要求分点的 `segmentRatio` 仅核验 `|DE|/|EA| = 2`，不擅自推导 `D/E/A` 共线。
   - **已记录的旧领域缺陷纠错**：明确修正 `lengthEquality.test.ts`（`DE=2EA` 曾断言 `splitPoint: true`）、`diagramObligations.test.ts`（矩形 `AB=2BC` 曾断言 `splitPoint: true`）与 `diagramVerification.test.ts`（`DE=2EA` 曾拒绝不共线点），同时保留明示线段位置 `pointOnSegment`（含新增的 `E在DA线段内` / `E在线段DA内` 写法）的正例与线外反例验证（`A=(0,0,0), E=(1,0,0), D=(1,2,0)` 裸 `DE=2EA` 通过，附加 `"E在DA线段内"` 时 `pointOnSegment` 明确拒绝）。
2. **完整角等式链与类型/单位边界**：
   - 新增 `packages/agent-core/src/relationChains.ts`（`parseAngleChains`、`STATED_VERTEX_ANGLE`）并在 `diagramObligations.ts` 句型表之前整条消费角等式链，保存完整链 `sourceText` / `start` / `end` 与多角子序号 `chainIndex`。
   - 完整解析 `∠ADB=∠ADC=60°` 为两条 `planarAngle`（顶点均为中间 `D`），原题 `GK-S06` 第（1）问及多问分片中不再残留 `"∠ADB="`。
   - 新增 `equalAngle` 义务类型，统一接入 `claimEvidence.ts`、`obligationIR.ts`（`JUDGED_KINDS`、`toleranceFor`、`chainIndex` 往返）与 `diagramVerification.ts`（抽出单一计算边界 `planarAngleDegrees`、`PRE_FOLD_KINDS`）。
   - 严格区分长度与角度单位：支持合法显式弧度 `(0, π)` 一次转度，拒绝截断右侧（`∠ADB=`）、长度等于角度（`∠ADB=AB` / `AB=∠ADC=60°` / `AB=60°`）、缺失单位（`∠ADB=60`）、度与弧度混用（`∠ADB=60°=1rad` / `∠ADB=60 rad`）以及非法角域（`0°` / `180°` / 重复顶点 `∠ABA`）。

## 2. RED -> GREEN 与实测验证

1. **RED 复现（修改产品代码前）**：
   - 命令：`npm.cmd exec -- vitest run packages/agent-core/src/lengthEquality.test.ts packages/agent-core/src/diagramObligations.test.ts packages/agent-core/src/diagramVerification.test.ts --testTimeout=30000`
   - 结果：3 files failed | `9 failed | 197 passed (206)`（`DE=2EA` `splitPoint` 仍为 `true`、`GK-S06` 仅吃 `∠ADC=60°` 并残留 `∠ADB=`、`equalAngle` 与显式弧度未实现、非共线裸比候选未通过）。
2. **GREEN 定向与回归**：
   - 新增 `packages/agent-core/src/relationChains.test.ts`（3 项），扩展 `lengthEquality.test.ts`（27 项）、`diagramObligations.test.ts`（109 项）、`diagramVerification.test.ts`（70 项），并同跑 `obligationIR.test.ts`（14 项）与 `planCompiler.offPath.golden.test.ts`（13 项）：**6 文件 / 236 passed (0 failed)**。
3. **全仓工程门禁**：
   - `npm.cmd test -- --testTimeout=30000`：**528 files / 5620 passed | 1 todo (5621)**。
   - `npm.cmd run typecheck`：exit 0（0 errors）。
   - `npm.cmd run lint`：exit 0（0 errors，32 条既有 warning）。
   - `npm.cmd run --workspace @draw/web build`：exit 0（636 modules）。
   - `npm.cmd run eval:reliability -- --offline`：exit 0（3 passed）。

## 3. 安全状态与剩余风险

- 仅修改离线解析与几何核验模块，未启用付费 provider、未改变原生/IPC 安全边界；回滚策略保留本次新负例与纠偏记录，绝不恢复把裸比推导为共线的错误数学结论。
- 后续符号 AST/参数域约束（`GK-P01`、`GK-P08`）按 DAG 交由 `P2 / T04` 处理。
