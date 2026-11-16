# P3 / T06 证据：必需对象清单与类型化无环构造意图 DAG

- **日期**：2026-11-16
- **区块**：`B4 / P3 / T06`（`feat(geometry): compile required objects into a typed construction DAG`）
- **依赖前置**：`T02`（`a70152aa`）、`T05`（`047f2c7c`）

## 1. 解决的问题

1. **类型化且无环检查的构造意图 DAG（`packages/agent-core/src/drawingIntent.ts`）**
   - 直接以 `actionRegistry.ts` 的 `ACTIONS` 作为单源算子能力表（另含受支持确定性求解复合算子 `solve.conic_focus`、`solve.segment_ratio_point`、`solve.line_intersection`、`solve.fold_transform`），显式拒绝任何未注册算子（`unsupported_operator`）。
   - 实现 `compileConstructionDag`：执行基于节点 ID 字典序的确定性 Kahn 拓扑排序，并在执行前静态拦截重复节点 ID（`duplicate_node_id`）、同作用域/状态重复实体（`duplicate_entity_id`）、缺失宿主/依赖（`missing_host`）、错宿主类型（`wrong_host_kind`）、未经过 `solid.fold` 状态迁移的折前对象违规引用（`pre_fold_host_violation`）、跨小问非法依赖（`cross_scope_violation`）与循环依赖（`cyclic_dependency`）。
   - 同步导出供后续 `T12` 增量重算使用的下游脏子图传播接口 `collectDependentSubgraph`。
2. **独立于模型动作列表的必需对象合成与物化审计（`drawingIntent.ts`）**
   - 实现 `deriveRequiredDrawingIntent`：复用 `parseObligationWithLegacy`、`parseShapeClause` 与 `readFoldTransformations` 从题面与契约直接合成必需节点清单（含底面多边形顶点、边宿主与比例分点 `E`/`F`、折叠状态迁移 `P`、椭圆/双曲线焦点 `F₁`/`F₂` 与曲线上点 `M`/`P` 等）。
   - 实现 `auditMaterializedIntent`：要求每个必需对象必须对应真实几何图元（`point` / `point3` / `ellipse` / `conic` / …），明确拦截缺实体（`missing_entity`）、仅用孤立标签文本假装物化（`isolated_label_without_primitive`）及必需辅助图元被设为隐藏（`auxiliary_object_hidden`）。
3. **路由/求解/编译器接入（`deterministicProblemRoute.ts`、`solver/solverContracts.ts`、`planCompiler.ts`）**
   - 在 `deterministicProblemRoute.ts` 新增 `routeDeterministicProblemWithIntent`、在 `solver/solverContracts.ts` 导出 `DrawingIntentContractSummary`，并在 `planCompiler.ts` 通过显式 `drawingIntentCheck` 开关接入编译器诊断与阻塞（默认关闭路径维持 off-path 黄金基线零漂移）。

## 2. RED → GREEN 实测证据

### 2.1 RED 失败基线

- 新增 `packages/agent-core/src/drawingIntent.test.ts`（5 项测试：DAG 六类异常拦截、拓扑序与 `T12` 脏传播、`GK-S02` 缺 `E/F/P` 与孤立 label / 隐藏辅助对象拦截、`JT-P06` 缺焦点 `F₁`/`F₂`、`compilePlan` `drawingIntentCheck` 端到端阻断）。
- 实现前运行 Vitest 报错退出码 `1`（`Failed to resolve import "./drawingIntent"`）。

### 2.2 最终代码改动后 GREEN 与全量实测（全部 exit 0）

| 命令 | 结果 |
| --- | --- |
| `npm.cmd exec -- vitest run packages/agent-core/src/drawingIntent.test.ts packages/agent-core/src/planCompiler.offPath.golden.test.ts --testTimeout=30000` | **2 passed (2) / 18 passed (18)** |
| `npm.cmd run typecheck` | **exit 0** |
| `npm.cmd run lint` | **exit 0**（0 errors） |
| `npm.cmd run --workspace @draw/web build` | **exit 0** |
| `npm.cmd run eval:reliability -- --offline` | **exit 0** |
| `npm.cmd test -- --testTimeout=30000` | **532 passed (532) \| 5648 passed \| 1 todo (5649)** |
| `npm.cmd run test:docs -- --testTimeout=30000` | 见提交前文档校验执行结果 |

## 3. 修改文件清单

- `packages/agent-core/src/drawingIntent.ts`（新增）
- `packages/agent-core/src/drawingIntent.test.ts`（新增）
- `packages/agent-core/src/deterministicProblemRoute.ts`
- `packages/agent-core/src/solver/solverContracts.ts`
- `packages/agent-core/src/planCompiler.ts`
- `docs/audit/2026-11-16-p3-drawing-intent-dag/README.md`（新增）
