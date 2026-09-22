import type { Coordinate, GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { reactive } from "@draw/geometry-kernel"
import { pathConstraint } from "@draw/scene-graph"

/**
 * **文档 → Reactive DAG 的适配层**（Reactive DAG 切片 Task 4）。
 *
 * 这一层只做两件事：把文档里**能进图的东西**建成节点，以及把"这一次拖动/改参数"送进图里求值。
 * 几何一行都不在这里实现 —— 绑定点、圆心、切线全部来自内核的 evaluator。
 *
 * 界面上由它驱动的是：拖动中的**临时轨迹**（`createTransientTrace`，只活在内存里、
 * 不进撤销历史）、拖动闭包的**读数与诊断**（`data-reactive-*`），以及**轨迹采样**
 * （反复驱动同一个参数节点，不做整文档重算）。
 *
 * 预览几何本身仍然走既有的 `applyOperation` + `recomputeDerivedObjects`：那一条路径已经被
 * 全部既有用例钉住，这里若再算一遍就成了第二份几何真源（规格 §1.2 禁止）。
 */

export interface DocumentGraphOptions {
  /** 需要额外建立的驱动参数节点（例如轨迹的扫描参数在文档里并不存在时）。 */
  readonly driverParameters?: readonly { id: string; value: number }[]
}

export interface DocumentGraph {
  readonly graph: reactive.ReactiveGraph
  /** 文档图元 id → 承担它几何的图节点 id（目前两者同名，保留映射是为了将来能重命名）。 */
  readonly geometryNodeIds: ReadonlyMap<string, string>
  /** 绑定点 id → 驱动参数节点 id（轨迹采样与拖动都要用它）。 */
  readonly driverParameterIds: ReadonlyMap<string, string>
}

/** 没有文档参数时给动点临时建一个驱动参数节点用的后缀。 */
const SYNTHETIC_PARAMETER_SUFFIX = ":t"

export function buildDocumentGraph(document: GeometryDocument, options: DocumentGraphOptions = {}): DocumentGraph {
  const graph = reactive.createReactiveGraph()
  const geometryNodeIds = new Map<string, string>()
  const driverParameterIds = new Map<string, string>()
  const byId = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))

  for (const [id, parameter] of Object.entries(document.parameters)) {
    graph.addNode(reactive.parameterNode(id, parameter.value, parameter.ownerId === undefined ? {} : { ownerId: parameter.ownerId }))
  }
  for (const driver of options.driverParameters ?? []) {
    if (!graph.hasNode(driver.id)) graph.addNode(reactive.parameterNode(driver.id, driver.value))
  }

  /**
   * 宿主节点：曲线 / 面 / 实体本身也是节点。
   *
   * 没有它们，绑定点声明的 `hostIds` 会指向不存在的节点，图会（正确地）报 `missing_source` ——
   * 那是"来源被删掉"的诊断，不是"宿主还没登记"。宿主的值放进图里是为了让 `setSource`
   * 能在宿主几何变化时把下游标脏。
   */
  const registerHost = (id: string) => {
    if (graph.hasNode(id)) return
    const host = byId.get(id)
    /**
     * 宿主图元**不存在**时什么都不登记：那条绑定声明的依赖就没有对应节点，图会（正确地）报
     * `missing_source` —— "缺少来源"才是"宿主被删掉"该有的诊断；登记一个 `null` 来源节点只会
     * 把它变成"宿主不合法"（`invalid_host` 留给"宿主在、但根本不是一条曲线"）。
     */
    if (host === undefined) return
    graph.addNode(reactive.sourceNode(id, host))
  }

  for (const primitive of document.primitives) {
    if (primitive.type === "point") {
      if (primitive.binding?.kind === "onPath") {
        registerHost(primitive.binding.pathId)
        const path = byId.get(primitive.binding.pathId)
        const documented = primitive.binding.parameterId
        const parameterId = documented ?? `${primitive.id}${SYNTHETIC_PARAMETER_SUFFIX}`
        if (documented === undefined) graph.addNode(reactive.parameterNode(parameterId, primitive.binding.parameter, { ownerId: primitive.id }))
        driverParameterIds.set(primitive.id, parameterId)
        graph.addNode(reactive.planarPointNode(primitive.id, {
          constraint: path ? pathConstraint(path, document.parameters) : null,
          parameterId,
          ...(primitive.binding.branch === undefined ? {} : { branch: primitive.binding.branch }),
          hostIds: [primitive.binding.pathId]
        }))
      } else {
        graph.addNode(reactive.sourceNode(primitive.id, { x: primitive.x, y: primitive.y }))
      }
      geometryNodeIds.set(primitive.id, primitive.id)
      continue
    }
    if (primitive.type === "circle" && primitive.radiusFrom?.kind === "triangle") {
      const nodes = reactive.triangleCircleNodes(primitive.id, {
        metric: primitive.radiusFrom.metric === "inradius" ? "incircle" : "circumcircle",
        pointIds: primitive.radiusFrom.triangleIds
      })
      graph.addNode(nodes.center)
      graph.addNode(nodes.radius)
      graph.addNode(nodes.circle)
      geometryNodeIds.set(primitive.id, primitive.id)
      continue
    }
    if ((primitive.type === "tangent" || primitive.type === "normal") && primitive.anchor?.kind === "point") {
      const source = byId.get(primitive.sourceId)
      registerHost(primitive.sourceId)
      graph.addNode(reactive.tangentAtPointNode(primitive.id, {
        constraint: source ? pathConstraint(source, document.parameters) : null,
        pointId: primitive.anchor.pointId,
        halfLength: primitive.halfLength ?? 1,
        hostIds: [primitive.sourceId]
      }))
      geometryNodeIds.set(primitive.id, primitive.id)
      continue
    }
    if (primitive.type === "locus") {
      const source = byId.get(primitive.sourcePointId)
      const driverId = source?.type === "point" && source.binding?.kind === "onPath"
        ? source.binding.parameterId ?? `${source.id}${SYNTHETIC_PARAMETER_SUFFIX}`
        : `${primitive.sourcePointId}${SYNTHETIC_PARAMETER_SUFFIX}`
      if (!graph.hasNode(driverId)) {
        const fallback = source?.type === "point" && source.binding?.kind === "onPath" ? source.binding.parameter : primitive.domain[0]
        graph.addNode(reactive.parameterNode(driverId, fallback))
      }
      graph.addNode(reactive.sourceNode(`${primitive.id}:samples`, { branches: [] }))
      graph.addNode(reactive.locusNode(primitive.id, { samplesId: `${primitive.id}:samples` }))
      geometryNodeIds.set(primitive.id, primitive.id)
    }
  }

  return { graph, geometryNodeIds, driverParameterIds }
}

export interface ReactivePreviewReport {
  /** 受影响的节点（含种子），按拓扑序。 */
  readonly affected: readonly string[]
  /** 这一趟真正执行了 evaluator 的节点。 */
  readonly evaluated: readonly string[]
  readonly diagnostics: readonly reactive.ReactiveDiagnostic[]
  /** 图算出来的坐标（演示 / 轨迹用）。没有可用值时**不含**该键。 */
  readonly points: ReadonlyMap<string, Coordinate>
}

/**
 * 把"文档当前的样子"同步进图并求一次闭包。
 *
 * 同步的方向是**文档 → 图**：拖动结束后文档是权威（预览也是文档的一份副本），
 * 图只回答"这次变化的下游闭包是什么、有没有诊断"。
 *
 * 绑定点的参数以**文档参数的真值**为准（`document.parameters[driverId].value`），绑定里那个
 * `binding.parameter` 只是缓存 —— 与文档层 `resolveBoundPoint3`/`resolveBoundPoint` 的优先顺序一致。
 * 种子也可能直接是**参数 id**（参数面板改滑块就是这种形状），那时同样先把新值写进图。
 */
export function evaluateDocumentGraph(graph: reactive.ReactiveGraph, document: GeometryDocument, changedIds: readonly string[]): ReactivePreviewReport {
  const seeds: string[] = []
  for (const id of changedIds) {
    // 种子是参数 id：文档参数才是真值来源（此时找不到同名图元，不能退化成"用图里旧值求值"）。
    const parameter = document.parameters[id]
    if (parameter !== undefined && graph.hasNode(id)) {
      graph.setParameter(id, parameter.value)
      seeds.push(id)
      continue
    }
    const primitive = document.primitives.find((candidate) => candidate.id === id)
    if (primitive?.type === "point") {
      if (primitive.binding?.kind === "onPath") {
        const driverId = driverParameterIdOf(primitive)
        if (graph.hasNode(driverId)) {
          graph.setParameter(driverId, document.parameters[driverId]?.value ?? primitive.binding.parameter)
          seeds.push(driverId)
        }
        continue
      }
      if (graph.hasNode(id)) {
        graph.setSource(id, { x: primitive.x, y: primitive.y })
        seeds.push(id)
      }
      continue
    }
    if (primitive && graph.hasNode(id) && primitive.type !== "locus") seeds.push(id)
  }
  const report = graph.evaluate(seeds.length > 0 ? seeds : changedIds.length > 0 ? changedIds : undefined)
  const points = new Map<string, Coordinate>()
  for (const id of document.primitives.filter((primitive) => primitive.type === "point").map((primitive) => primitive.id)) {
    const result = graph.result(id)
    if (result === undefined) continue
    const point = reactive.coordinateInput(new Map([[id, result]]), id)
    if (point) points.set(id, point)
  }
  return {
    affected: graph.affectedNodes(seeds),
    evaluated: report.evaluated,
    diagnostics: report.diagnostics,
    points
  }
}

/**
 * 轨迹扫描该驱动哪个参数（评审 M3）。
 *
 * 优先级与**旧渲染**一致，这一步是有意保守的：
 * 1. 轨迹自己声明的 `parameterId` 存在（`document.parameters` 里真的有它）→ 用它；
 * 2. 声明了但在文档里解析不出来（另一条切片写过 `locus-<id>` 这种不存在的 id）→ 返回 `null`，
 *    渲染层**什么都不画** —— 旧实现就是这样，换成"随便找个参数扫一遍"会画出一条误导曲线；
 * 3. 根本没声明（老文档）→ 用动点自己的驱动参数（文档参数，或图里那个合成参数节点）；
 * 4. 两者都不可用 → `null`。
 */
export function locusDriverParameterId(document: GeometryDocument, locus: Extract<PrimitiveSpec, { type: "locus" }>, hasNode: (id: string) => boolean): string | null {
  if (locus.parameterId !== undefined && locus.parameterId !== "") return document.parameters[locus.parameterId] === undefined ? null : locus.parameterId
  const source = document.primitives.find((primitive) => primitive.id === locus.sourcePointId)
  if (source?.type !== "point" || source.binding?.kind !== "onPath") return null
  const bindingDriver = source.binding.parameterId ?? `${source.id}${SYNTHETIC_PARAMETER_SUFFIX}`
  return hasNode(bindingDriver) ? bindingDriver : null
}

/** 绑定点在图里的参数节点 id：文档参数优先，没有就退回那个合成节点。 */
function driverParameterIdOf(point: Extract<PrimitiveSpec, { type: "point" }>): string {
  return point.binding?.kind === "onPath" ? point.binding.parameterId ?? `${point.id}${SYNTHETIC_PARAMETER_SUFFIX}` : point.id
}

/** 轨迹采样：只驱动一个参数节点，采样结束后参数回到原处（采样是只读遍历）。 */
export function sampleLocusThroughGraph(
  graph: reactive.ReactiveGraph,
  options: {
    pointId: string
    parameterId: string
    domain: readonly [number, number]
    samples?: number
    tolerance?: number
    /** 采样预算：调用方沿用旧渲染那套口径（`jumpFactor 4`、`maxDepth 5`、`breakDepth 20`、`maxEvaluations max(samples*8,256)`）。 */
    jumpFactor?: number
    maxJump?: number
    maxDepth?: number
    breakDepth?: number
    maxEvaluations?: number
  }
): { branches: readonly (readonly Coordinate[])[]; evaluations: number; truncated: boolean } {
  const result = reactive.sampleLocusFromGraph({
    graph,
    pointId: options.pointId,
    parameterId: options.parameterId,
    domain: options.domain,
    ...(options.samples === undefined ? {} : { samples: options.samples }),
    ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }),
    ...(options.jumpFactor === undefined ? {} : { jumpFactor: options.jumpFactor }),
    ...(options.maxJump === undefined ? {} : { maxJump: options.maxJump }),
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.breakDepth === undefined ? {} : { breakDepth: options.breakDepth }),
    ...(options.maxEvaluations === undefined ? {} : { maxEvaluations: options.maxEvaluations })
  })
  return { branches: result.branches, evaluations: result.evaluations, truncated: result.truncated }
}

/** 把采样结果写回图（持久化的轨迹节点从这里取值）。 */
export function publishLocusSamples(graph: reactive.ReactiveGraph, locusId: string, branches: readonly (readonly Coordinate[])[]): void {
  graph.setSource(`${locusId}:samples`, { branches })
}
