import type { Coordinate } from "@draw/dsl"

/**
 * **Reactive DAG 的契约**（设计规格 §4.1/§4.2）。
 *
 * 规格 §4.1 的节点类型：
 *
 * ```ts
 * type ReactiveNode = SourceNode | ParameterNode | ConstraintNode | DerivedNode | MeasurementNode | LocusNode
 * ```
 *
 * 与既有的 `dependency-graph.ts` 的关系：那边是**通用**的依赖图 + 值缓存调度器（`createDependencyGraph`
 * 提供拓扑序 / 脏闭包 / 环检测），这边是**几何求值**那一层，按规格给出四态结果与结构化诊断。
 * 两者不重复：图的边与拓扑序仍然只有一份（见 `graph.ts` 里对 `createDependencyGraph` 的复用）。
 *
 * 两个必须写进类型里的不变式：
 * 1. **求值是纯函数**：`NodeEvaluator` 只拿到上游结果，不接触文档、DOM、时间或全局状态；
 * 2. **失败有四态且都能区分**：`exact` / `approximate`（必带残差）/ `undefined` / `degenerate`，
 *    任何一态都不会退化成"某个凑出来的坐标"。
 */

/** 六种节点（规格 §4.1）。 */
export type ReactiveNodeKind = "source" | "parameter" | "constraint" | "derived" | "measurement" | "locus"

/**
 * 诊断码。前四个是规格点名的失败方式（环、缺失来源、非有限、退化），
 * 后两个是它们的近亲：宿主参数越界、宿主本身不可解析。
 */
export type ReactiveDiagnosticCode =
  | "dependency_cycle"
  | "missing_source"
  | "non_finite"
  | "degenerate"
  | "invalid_domain"
  | "invalid_host"
  | "evaluation_failed"

export interface ReactiveDiagnostic {
  readonly code: ReactiveDiagnosticCode
  /** 报告这条诊断的节点（也就是"算不出值"的那一个）。 */
  readonly nodeId: string
  readonly message: string
  /** 直接导致失败的上游节点 id（缺失来源 / 上游失败时填）。 */
  readonly upstream?: string
}

/**
 * 求值结果。与 `DerivedSolidResult`（规格 §3.1）保持同一组状态名：
 * 折叠成"有结果 / 没结果"就等于允许近似冒充精确、允许失败沿用旧缓存（规格 §10 明确禁止）。
 */
export type EvaluationResult<Value = unknown> =
  | { readonly status: "exact"; readonly value: Value }
  | { readonly status: "approximate"; readonly value: Value; readonly residual: number }
  | { readonly status: "undefined"; readonly diagnostic: ReactiveDiagnostic }
  | { readonly status: "degenerate"; readonly diagnostic: ReactiveDiagnostic }

/** 纯求值器：给定上游结果（按 id）返回本节点的结果。不得读写任何外部状态。 */
export type NodeEvaluator<Value = unknown> = (inputs: ReadonlyMap<string, EvaluationResult<unknown>>) => EvaluationResult<Value>

/** 只有来源节点（参数 / 外部输入）直接持有值；其余节点的值一律由 `evaluate` 算出。 */
export interface SourceNode {
  readonly kind: "source"
  readonly id: string
  readonly value: unknown
}

export interface ParameterNode {
  readonly kind: "parameter"
  readonly id: string
  readonly value: number
  /**
   * 自动生成的驱动参数归属于哪个对象（`t-<点id>` → 点）。
   * 宿主被删除时按这个字段回收孤儿参数（scene-graph 的删除计划已经在做，这里只是把归属带上）。
   */
  readonly ownerId?: string
}

interface EvaluatedNodeFields<Value> {
  readonly id: string
  readonly dependsOn: readonly string[]
  readonly evaluate: NodeEvaluator<Value>
}

export type ConstraintNode<Value = unknown> = EvaluatedNodeFields<Value> & { readonly kind: "constraint" }
export type DerivedNode<Value = unknown> = EvaluatedNodeFields<Value> & { readonly kind: "derived" }
export type MeasurementNode = EvaluatedNodeFields<number> & { readonly kind: "measurement" }
/** 轨迹的值是**分支数组**（渐近线 / 间断点两侧不能连线，规格 §4.4）。 */
export type LocusNode = EvaluatedNodeFields<readonly (readonly Coordinate[])[]> & { readonly kind: "locus" }

export type ReactiveNode = SourceNode | ParameterNode | ConstraintNode | DerivedNode | MeasurementNode | LocusNode

/** 需要执行 evaluator 的节点（来源与参数节点除外）。 */
export type EvaluatedReactiveNode = ConstraintNode | DerivedNode | MeasurementNode | LocusNode
