# G3-F9 内核动作修复 Task 4 审计记录：Live 多范围 / 多状态 / 多分支 `CandidateSet` 接线（0 新增付费）

> **边界声明**：本区块 **0 新增付费 DeepSeek API 调用**；打通了 `ds_action` 从 `dsActionSession` → `modelPlanner` → `g3DsFrozenCaseRunner` 的真实多范围 / 多状态 / 多分支 `CandidateSliceArtifact[]` 接线与 `drawingContracts` / `drawingCertificate` 核验对齐，真实 DS 仍未重测。

## 1. 本轮改动与实现核对

1. **计划结果携带可选多切片（[coordinatorPorts.ts](../../../packages/agent-core/src/coordinatorPorts.ts)）**
   - `PlanOutcome` 计划分支新增可选 `candidateSlices?: readonly CandidatePlanSlice[]`，保持既有 `PlanEnvelope` 解析严格契约不变。
2. **分支画布隔离、抛物线支持与多状态切片（[dsActionTools.ts](../../../apps/web/src/agent/dsActionTools.ts)）**
   - 为带 `branchId` 的工具调用按分支维护独立 `SpeculativeCanvas`（复用共享无分支底图与单调 `actionKey`），解决同名点在不同分支中碰撞（`duplicate_action_key`）的问题；`construct_conic` 补齐 `parabola` 参数校验与构建；`finish_candidate` 将所有已建状态的真实动作切片 `slices` 一并随 `terminated` 返回。
3. **规划器回传与 Frozen Runner 切片展开（[modelPlanner.ts](../../../apps/web/src/agent/modelPlanner.ts)、[g3DsFrozenCaseRunner.ts](../../../apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts)）**
   - `modelPlanner` 将 `terminated.slices` 映射为 `PlanOutcome.candidateSlices`；`runFrozenDsCase` 逐切片编译 `materializeSliceDocument`（对 `compilePlan` 产生的精确同位面顶重复点做等坐标拓扑焊接）并用 `evaluateFrozenCandidateSet` 独立认证与判定；预折状态 `before_fold` 仅在所有 pre-fold 义务通过且缺失名称全部为后续 `solid.fold` 产出顶点时允许随折后终态一并认证。
4. **开放折展表面拓扑与无重复点（[drawingContracts.ts](../../../scripts/reliability-eval/drawingContracts.ts)）**
   - 当 `check.open === true`（如 `GK-S02` 的 `ob-open-topology`）且候选图由 `solid.create_face + solid.fold` 编译为连通 `face3` 集合时，`evaluatePolyhedronTopology` 直接基于实际 `face3` 网格运行 `buildOpenSurface` 连通性与期望顶点核验（闭合体判据完全不变）。

## 2. 实测验证结果

- `vitest run apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts apps/web/src/agent/dsActionTools.test.ts apps/web/src/agent/modelPlanner.test.ts scripts/reliability-eval/drawingContracts.test.ts --testTimeout=30000`：**`4` 文件 `131 passed`**（含 live `ds_action` 执行 `GK-S02` `before_fold` / `after_fold` 与 `GK-P06` `zero` / `positive` / `negative` 通过、缺分支 `incomplete` 反例、且请求不含 `requiredObligations` / `expectedResult`）。
- `npm.cmd run typecheck`：退出 `0`
- `npm.cmd run lint`：**`0 errors`**
- `npm.cmd run test:docs -- --testTimeout=30000`：随文档更新一并核验

## 3. 下一步

- 推进 [G3-F9 内核动作修复计划](../../g3-final/G3-F9-kernel-action-repair-plan.md) **Task 5（0 付费全量离线验证闭环、E2E 重跑与停留在真实 DS 重授权闸口）**。
