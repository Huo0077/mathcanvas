export * from "./types"
export * from "./intersections"
export * from "./snap-geometry"
export * from "./selection"
export * from "./editing"
export * from "./evaluate"
export * from "./expression"
export * from "./function-presets"
export * from "./parameters"
export * from "./constraints"
export * from "./numeric"
export * from "./polyline"
export * from "./conics"
export * from "./calculus"
export * from "./curve-intersections"
export * from "./animation"
export * from "./geometry3d"
export * from "./solid-builders"
export * from "./prism"
export * from "./quadrics"
export * from "./section-quadric"
export * from "./sphere"
export * from "./intersection-surfaces"
export * from "./measurements3d"
export * from "./constraints3d"
export * from "./constraints3dProjection"
export * from "./linear-algebra"
export * from "./hosts3"
export * from "./sections3d"
export * from "./solidDerived"
export * from "./intersections3d"
export * from "./boolean3d"
export * from "./unfold3d"
export * from "./markers3d"
export * from "./projections3d"
export * from "./rotation3d"
export * from "./projection-conics"
export * from "./engineeringAnnotations"
export * from "./planar-constraints"
export * from "./dynamic-points"
export * from "./dependency-graph"
export * from "./dynamic-measurements"
export * from "./locus-sampling"
export * from "./polynomial"
export * from "./exact-forms"
/**
 * **见证构造与残差**（N2 子任务 2a）。
 *
 * 扁平导出（而不是命名空间）：`constructWitnessShape` / `candidateResiduals` 这些名字
 * 不与既有导出冲突，而 `agent-core` 的见证搜索（2b）要直接从包根取用它们。
 * 这一层只做纯几何构造与形状 / 尺度判据，**不 import `@draw/agent-core`**（控制器 R12：
 * 内核依赖方向是单向的，反向 import 会成环）；题设验收仍在 `verifyDiagramObligations`。
 */
export * from "./witness/constructors"
export * from "./witness/residuals"
/**
 * Reactive DAG 切片（设计规格 §4）。
 *
 * 用**命名空间**导出而不是 `export *`：`ReactiveNode` / `ReactiveGraph` 这两个名字已经被
 * `dependency-graph.ts` 占用（那边是通用调度器，这里是几何求值层），扁平导出会让这两个名字
 * 变成歧义导出（TS2308）而无法从包根使用。命名空间让规格里的名字原样保留，同时不与既有 API 打架。
 */
export * as reactive from "./reactive"
/**
 * 三角形五心与半径的**纯函数**单独扁平导出：`scene-graph` 的派生圆规则要用它们
 * （"内切圆半径 = 三角形的内切圆半径"这条规则在两个包里必须是同一份几何），
 * 而这两个名字不与既有导出冲突，不必走命名空间。
 */
export { triangleCenter, triangleCenter2, triangleRadius, triangleRadius2 } from "./reactive/triangleCenters"
/**
 * 交互式临时轨迹（规格 §4.4）也扁平导出：画布要直接用它记录拖动轨迹，
 * 而它只是一个内存缓冲，名字不与任何既有导出冲突。
 */
export { createTransientTrace, type TransientTrace } from "./reactive/locus"
/**
 * 3D 宿主参数的**归一化**也扁平导出：文档层（`scene-graph` 的 `resolveBoundPoint3`）必须与图
 * 用同一份域语义，否则"圆周角 π/2 + 4π"在两条路径上会落在不同的点（fix round 1 / I5）。
 */
export { normalizeHostParameter } from "./reactive/constraints"
/**
 * **点名语法的唯一来源**（S1，立体图形覆盖扩宽）。扁平导出：解析器（`diagramObligations`）、
 * 核验器（`diagramVerification`）与内核自己的顶面命名要的是**同一份**判断，
 * 而这三处此前各写一份（`[...value]` 按码位拆字 / `/^[A-Z]$/` / 自己拼 `A′`）。
 */
export * from "./pointNames"
