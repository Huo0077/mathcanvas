# P7 / T15 真实画布渲染证据、分层视觉校验与标签不改数学避让证据

- **任务编号**：`T15`（B5 / P7 阶段，遵循 `implementation-task-ledger.json` DAG：`T14, R08 → T15`）
- **提交信息**：`feat(render): verify actual diagram visibility and labels`
- **日期**：2026-11-17
- **目标**：严格区分 `structuredOnly`、`rendered` 与 `humanReviewed` 三层视觉证据（禁止静默升级、关停开关回退为 `unverified`）；在保留全部数学坐标不变的前提下仅调整 DOM/标签偏移避免重叠，并在真实 Chromium 浏览器上以固定视口对平面、圆锥曲线、函数切线与三维折叠四族场景做 DOM 测量、`canonicalContentHash` 对账与反例拦截。

## 1. 交付内容

1. **分层视觉证据与无数学变更标签布局避让**：
   - [`packages/agent-core/src/verification/renderEvidence.ts`](../../../packages/agent-core/src/verification/renderEvidence.ts)：新增 `VisualEvidenceTier`（`"structuredOnly" | "rendered" | "humanReviewed"`）、`classifyVisualEvidenceTier`、`assertNoVisualTierUpgrade`（关闭开关返回 `visualStatus: "unverified"`）与 `adjustLayoutWithoutMutatingMath`（只允许偏移超出/重叠标签盒子，数学对象坐标逐字节不动，无法放置时降级 `needs_human_review`）。
   - [`apps/web/src/agent/renderLayoutInput.ts`](../../../apps/web/src/agent/renderLayoutInput.ts)：新增 `collectRenderLayoutEvidenceInput`，记录 `tier: "rendered"`、可见点标签、`missingRequiredLabels` 与 3D 隐藏虚线统计，并在返回前调用 `adjustLayoutWithoutMutatingMath`。
   - [`apps/web/src/canvasEvidence.ts`](../../../apps/web/src/canvasEvidence.ts) 与 [`apps/web/src/agent/agentRunner.ts`](../../../apps/web/src/agent/agentRunner.ts)：在真 DOM 画布属性导出 `"data-render-evidence-tier": "rendered"`，而提交前结构化门禁 `buildStructuredCandidateRenderEvidence` 显式标记 `evidenceTier: "structuredOnly"`。
2. **圆锥曲线与显式直线相交补全（E2E 联调曝光并修复）**：
   - [`packages/agent-core/src/solver/planarDrawing.ts`](../../../packages/agent-core/src/solver/planarDrawing.ts)：补全显式直线方程（`y = c` / `x = c` / `y = kx + b`）与圆锥曲线求交并物化对应直线与交点（如 `x²/9 + y²/4 = 1` 与 `y = 0` 相交于 `A(-3,0), B(3,0)`）。
3. **四族真画布 E2E 渲染与反例测试**：
   - 新建 [`e2e/drawing-reliability-render.spec.ts`](../../../e2e/drawing-reliability-render.spec.ts)（固定视口 `1280×800`、`deviceScaleFactor: 1`）：覆盖圆锥曲线与直线交点（2D SVG）、平面三角形 `ABC`（3D 标牌 `A,B,C`）、`f(x)=x³−3x` 与 `x=1` 切线（2D SVG）及四边形 `ABCD` 沿 `EF` 翻折至 `PEF`（3D 标牌 `A,B,C,D,E,F,P`）四族渲染、`data-document-hash` 与 `localStorage` 文档独立 SHA-256 对齐、`hidden` 隐藏标签与 `Control+z` 清空画布 `empty_canvas` 拒收；人工抽检渲染截图 `t15-conic-rendered.png` 与 `t15-solid-fold-rendered.png` 清晰无重叠。

## 2. RED → GREEN 与全量验证记录

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| RED（单测） | `npm.cmd exec -- vitest run packages/agent-core/src/verification/renderEvidence.test.ts --testTimeout=30000` | 按预期失败：`2 failed \| 22 passed (24)` |
| RED（Playwright E2E） | `npm.cmd exec -- playwright test e2e/drawing-reliability-render.spec.ts --workers=1 --retries=0` | `2 failed`（显式 `y=0` 交点缺失及 2D/3D 属性口径区分） |
| 定向 Vitest | `npm.cmd exec -- vitest run packages/agent-core/src/verification/renderEvidence.test.ts packages/agent-core/src/solver/planarDrawing.test.ts apps/web/src/canvasEvidence.test.ts --testTimeout=30000` | `3 passed (3) \| 47 passed (47)` |
| 定向 Playwright E2E | `npm.cmd exec -- playwright test e2e/drawing-reliability-render.spec.ts --workers=1 --retries=0` | `2 passed (27.9s)`，已人工核查截图 |
| 全量 TypeScript 类型检查 | `npm.cmd run typecheck` | exit 0 |
| 全量 ESLint | `npm.cmd run lint` | exit 0（0 errors，33 pre-existing warnings） |
| Web 生产构建 | `npm.cmd run --workspace @draw/web build` | exit 0 |
| 离线评测 | `npm.cmd run eval:reliability -- --offline` | `1 passed (1) \| 3 passed (3)` |
| 全量 Vitest 套件（最终编辑后） | `npm.cmd test -- --testTimeout=30000` | `540 passed (540) \| 5742 passed \| 1 todo (5743)` |
