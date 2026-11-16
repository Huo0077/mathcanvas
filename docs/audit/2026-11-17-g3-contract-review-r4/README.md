# G3 / T01 第四轮（终审）独立全量契约复核与 36 题 G3-Math 基线

- **日期**：2026-11-17
- **代码基准**：`391edc00`（`T15` 已落盘）+ Task 1（R3 五项阻断整改与 R4 独立全量复核）
- **状态边界**：
  - `T01 / P0` **已完成第二位独立审阅者全量复核**（`suite` 及 36/36 case `independentReviewStatus: "approved"`），四道 `如图` 题图引用案（`GK-S02`、`GK-S03`、`JT-S06`、`JT-S07`）仍诚实保持 `inputMode: "text_with_figure_reference"` 与未证实 `unsupportedReasons`（不伪造题图面环或哈希）。
  - **G3-Math 仍未退出**：当前确定性本地离线 36 题评测尚停留在 `0 passed`，须在后续 Task 2（生产完整证书接入）与 Task 3–4（18 平面 + 18 立体确定性构造与验证）完成后方能关闭 `G3-Math`。

## 一、R3 五项合同阻断逐项 RED → GREEN 与 R4 独立核验结论（全部 `PASS`）

1. **`GK-P06` 弦直线 `AB` 与中点切触绑定**
   - `test-fixtures/reliability/drawing-contracts-36.json` 新增 `ob-a-on-ab`、`ob-b-on-ab`（`scope: "stem"`）与 `ob-m-on-ab`、`ob-m-on-seg-ab`（`scope: "(2)"`），并在 `zero` / `positive` / `negative` 三个 `ob-e-tangent` 分支统一绑定 `touchPointLabel: "M"`。
   - `scripts/reliability-eval/drawingContracts.test.ts` 新增反例：将 `d=-1` 的点与圆搭接 `d=+1` 的替身 `AB` 直线提交至 `positive` 分支，准确在 `ob-a-on-ab`、`ob-b-on-ab`、`ob-m-on-ab`、`ob-e-tangent` 失败。
2. **`JT-P02` 禁止退化 `P=(-1,0)` 及平凡端点**
   - 新增 `noncollinear-2d` 判据与契约义务 `ob-p-off-axis`（强制 `P` 离开对称轴 `A₁A₂` 即 `y_P ≠ 0`）、`ob-m-ne-a1`、`ob-n-ne-a2`、`ob-m-ne-n`。
   - 反例测试实证拒收 `P=(-1,0), M=(2,0), N=(-2,0)` 及 `M=A₁` 退化情形。
3. **`JT-S04` 六面体闭合拓扑与 ±90° 对称镜像翻折**
   - 将 `ob-open-topology` 替换为闭合六面体 `ob-closed-topology`（`[["A","B","E","F"],["F","E","C","D"],["A","F","D"],["B","C","E"],["A","D","B"],["B","D","C"]]`），主折叠 `ob-fold-transform` 与 `folded-trapezoid-min-skew-cosine-3d` 统一支持 `allowMirror: true`（`±90°`）。
   - `solid-builders.ts` `buildFromPoints` 独立验证 6 面均共面非退化且每条棱恰被相邻两面反向共用；测试同时覆盖 `±90°` 主折与 `BE=6` 异面角最值，并拒绝仅两张开放曲面的伪提交。
4. **`GK-S09 / JT-S01 / JT-S09` 绑定命名立体而非任意 `polyhedronVertexSets.some(...)`**
   - `drawingContracts.ts` 新增 `resolveNamedPolyhedronVertexSets` 严格按 `expectedVertexIds`（及可选 `solidId`）唯一匹配目标 `polyhedron3`（`matchingSolids.length === 1`），`circumsphere-3d` 与 `hemisphere-3d` 未显式指定 `sphereId` 时亦要求唯一定位球体。
   - `GK-S09`、`JT-S01`、`JT-S09` 新增“损坏命名立体 + 合法匿名替身立体”反例测试并全部拒收。
5. **全局 `points3Of` / `points2Of` 重复标签/别名覆盖与图元类型失配拦截**
   - `drawingContracts.ts` 新增 `inspectPointAndPrimitiveIntegrity` 拦截重复 `id`、跨下标归一化别名碰撞（如 `A1` 与 `A₁`、`P:bad` 与 `P`）及 `point` / `point3` 维度失配，不再由最后一条同名图元静默覆写；`evaluateDrawingContractStates` 不再把多状态图元直接拼接为假重复集。
   - 反例测试实证拦截重复标签、归一化别名碰撞及错维点类型。

## 二、R4 独立只读审计（Subagent）与 36 题离线 G3-Math 基线

- **独立只读复核**（read-only subagent）：结论 **`PASS`**（5/5 R3 阻断全消、36/36 `manifest.json` 原文/SHA-256 哈希/`sourceSpan` 精确匹配、`GK-S02/GK-S03/JT-S06/JT-S07` 保持 `text_with_figure_reference` 诚实未知边界）。
- **验证命令（最后一次编辑后）**：
  - `npm.cmd exec -- vitest run scripts/reliability-eval/drawingContracts.test.ts`：**45/45 passed**（exit 0）。
  - `npm.cmd run typecheck`：**exit 0**（含 `@draw/web`、`@draw/desktop`、`@draw/agent-core`、`@draw/dsl`、`@draw/geometry-kernel`、`@draw/scene-graph`、`e2e`、`scripts`）。
  - `npm.cmd run lint`：**exit 0**（0 errors，33 既有 warnings）。
  - `npm.cmd test -- --testTimeout=30000`：**540 passed (540) | 5743 passed | 1 todo (5744)**（exit 0）。
  - `npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`：报告目录 `eval-results/reliability/offline-2026-11-16T16-56-14.645Z-34888/summary.json`，真实 `G3-Math` 离线基线为 **`0 passed / 11 partial / 25 failed / 0 incomplete`**（分母固定 36；对象平均覆盖 **23.5%**、义务平均覆盖 **18.9%**，`requests: 36`，`costKnown: false, costUsd: null`）。
