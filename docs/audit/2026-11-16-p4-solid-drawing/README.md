# P4 / T09 证据：参数化立体构造、拓扑拒收与开放曲面隔离

- **日期**：2026-11-16
- **区块**：`B4 / T09`（`feat(solid): build constrained solids without guessed topology`）
- **依赖前置**：`T06`（`92f7f419`）、`T11`（`310d150a`）

## 1. 解决的问题

1. **几何内核闭合拓扑与开放曲面隔离（`packages/geometry-kernel/src/solid-builders.ts`）**
   - 导出 `signedPolyhedronVolume`（顶点-面有符号体积计算并复用至 `hasNonZeroVolume`）。
   - 保持 `buildFromPoints` 完整闭合流形校验不放松，同时针对合法开放折纸片新增 `buildOpenSurface`（逐环验共面、非零面积、非自交、连通性与邻边反向绕向，不以闭合边边界条件误杀合法开放曲面）。
   - 在 `solid-builders.test.ts` 以 `GK-S03`（等腰梯形组 `ABCD`/`ADEF` 五面体）实测验证正有符号体积闭合拓扑与 7 类拓扑损坏拒收（非共面面、蝴蝶结自交、反向绕向、重复面、未用顶点、不连通多壳、共面零体积）。
2. **参数化棱柱、已知/未知垂足棱锥、四面体镜像分支与辅助点宿主检验**
   - `packages/agent-core/src/solver/prism.ts`：新增 `constructParameterizedPrism`，按 `kind: "right" | "oblique"` 区分直棱柱（严格沿底面单位法向拉伸并拒绝斜拉向量）与斜棱柱（强制保留侧棱倾斜方向而不套用直棱柱模板），并通过 `buildPrism` 与 `signedPolyhedronVolume` 独立校验。
   - `packages/agent-core/src/solver/pyramid.ts`：新增 `constructPyramidFromFoot`（已知垂足时沿底面单位法向 `apex = foot ± h·n` 构造并验证正交残差）与 `describePyramidApexDomain`（未知垂足显式标出自由域，绝不擅自把顶点设为底面中心）。
   - `packages/agent-core/src/solver/tetrahedron.ts`：新增 `constructTetrahedronBranches`，显式生成并按 `sideFilter` / `expectedSide` 筛选正/负镜像分支，各分支独立校验六棱长度残差与闭合多面体拓扑。
   - `packages/agent-core/src/solver/witnessSearch.ts` 与 `solverContracts.ts`：新增 `validateAuxiliaryHosts`（拦截缺失顶点宿主 `missing_host`、重名冲突与非法棱参数并接入 `auxiliaryPointActions`）与 `SolidConstructionEvidence`。

## 2. RED → GREEN 实测证据

### 2.1 RED 失败基线

- 在 `solid-builders.test.ts`、`prism.test.ts`、`pyramid.test.ts` 扩充 `6` 项并新建 `solidDrawingContracts.test.ts`（`3` 项），实现前运行 Vitest 按预期失败：**4 files failed | 9 failed | 46 passed (55)**（缺失导出 `signedPolyhedronVolume`、`buildOpenSurface`、`constructParameterizedPrism`、`constructPyramidFromFoot`、`describePyramidApexDomain`、`constructTetrahedronBranches`、`validateAuxiliaryHosts`）。

### 2.2 最终代码改动后 GREEN 与全量实测（全部 exit 0）

| 命令 | 结果 |
| --- | --- |
| `npm.cmd exec -- vitest run packages/geometry-kernel/src/solid-builders.test.ts packages/agent-core/src/solver/prism.test.ts packages/agent-core/src/solver/pyramid.test.ts packages/agent-core/src/solver/solidDrawingContracts.test.ts --testTimeout=30000` | **4 passed (4) \| 55 passed (55)** |
| `npm.cmd run typecheck` | **exit 0** |
| `npm.cmd run lint` | **exit 0**（0 errors） |
| `npm.cmd run --workspace @draw/web build` | **exit 0** |
| `npm.cmd run eval:reliability -- --offline` | **exit 0** |
| `npm.cmd test -- --testTimeout=30000` | **536 passed (536) \| 5684 passed \| 1 todo (5685)** |
| `npm.cmd run test:docs -- --testTimeout=30000` | 提交前执行确认 |

## 3. 修改文件清单

- `packages/geometry-kernel/src/solid-builders.ts`
- `packages/agent-core/src/solver/prism.ts`
- `packages/agent-core/src/solver/pyramid.ts`
- `packages/agent-core/src/solver/tetrahedron.ts`
- `packages/agent-core/src/solver/solverContracts.ts`
- `packages/agent-core/src/solver/witnessSearch.ts`
- `packages/geometry-kernel/src/solid-builders.test.ts`
- `packages/agent-core/src/solver/prism.test.ts`
- `packages/agent-core/src/solver/pyramid.test.ts`
- `packages/agent-core/src/solver/solidDrawingContracts.test.ts`（新增）
- `docs/audit/2026-11-16-p4-solid-drawing/README.md`（新增）
