import { createDependencyGraph } from "../dependency-graph"

import { cycleMemberDiagnostic, diagnosticOf, isResolved, missingSourceDiagnostic, nonFiniteDiagnostic, nonFinitePath, resolvedValue, runEvaluator } from "./evaluator"
import type { EvaluationResult, ReactiveDiagnostic, ReactiveNode } from "./types"

/**
 * **ReactiveGraph**：几何求值的增量调度器（设计规格 §4.1/§4.2）。
 *
 * ```text
 * 参数变化 -> 反向依赖闭包 -> 拓扑排序 -> 纯 evaluator -> 临时场景预览 -> 抬手后一次性提交
 * ```
 *
 * 与既有 `dependency-graph.ts` 的分工是**刻意的**：拓扑排序、脏闭包、环检测只有一份实现
 * （`createDependencyGraph`），本模块在它之上补的是几何求值需要的语义：
 *
 * - **四态结果 + 结构化诊断**：既有调度器把异常记在 `errors` 里并"宁可显示过期数据"，
 *   而规格 §4.2 明确禁止用旧缓存伪装正常结果，所以这里失败即**作废缓存**；
 * - **环在求值期报告**：既有调度器在构造期直接抛异常。规格要求环是 `dependency_cycle` 诊断，
 *   因此本层允许建出带环的图，并在求值时**先拒绝环、再调用任何 evaluator**；
 * - **剪枝**：上游结果对象逐一不变（`Object.is`）时不重跑 evaluator —— 纯函数 + 同一份输入 ⇒
 *   同一份输出，因此这一步是安全的，也是"只重算下游闭包"的落点。
 *
 * 失败传播规则（只此一条，避免下游出现"半个结果"）：节点**自己**报具体码
 * （`non_finite` / `degenerate` / `evaluation_failed` / `dependency_cycle`），
 * 而**下游**因为上游不可用而算不出来的一律报 `missing_source`，并在 `upstream` 里指出是谁、
 * 在文案里保留上游的状态。
 */

export interface EvaluationReport {
  /** 真正执行了 evaluator 的节点（按拓扑序）。 */
  readonly evaluated: readonly string[]
  /** 在闭包内、但上游结果逐一未变（或被剪掉）因而跳过的节点。 */
  readonly reused: readonly string[]
  /** 这一趟产生的诊断（失败节点各一条）。 */
  readonly diagnostics: readonly ReactiveDiagnostic[]
  /** 有值的节点（`exact` / `approximate`）。 */
  readonly values: ReadonlyMap<string, unknown>
}

export interface ReactiveGraph {
  addNode(node: ReactiveNode): void
  removeNode(id: string): void
  hasNode(id: string): boolean
  nodeIds(): readonly string[]
  node(id: string): ReactiveNode | undefined
  /**
   * 参数的真值。写非有限值会被**拒绝**：真值保持上一个有限值，返回 `{status:"undefined"}` +
   * `non_finite` 诊断（不报 `exact`——那会让调用方以为写入成功了），并且这条诊断会一直挂在
   * `diagnostics()` / 后续求值报告里，直到有一次合法写入。
   */
  setParameter(id: string, value: number): EvaluationResult<number>
  /**
   * 来源节点（图元坐标这类"外部真值"）的写入。
   *
   * 与 `setParameter` 同样是**只向下游传播**的种子：值变了就换结果对象，没变就保留原对象
   * （于是下游会因为"输入未变"被剪枝）。非有限值不会被立刻拒绝 —— 求值时统一由
   * `nonFinitePath` 报 `non_finite` 诊断，这样"坏输入"与"坏输出"走同一条路。
   *
   * **宿主几何不在其中**：约束节点 / 切线节点在**构造期**就把解析好的 `PlanarConstraint` / `Host3`
   * 闭包捕获了，所以 `setSource(hostId, 新几何)` 只会让下游进 `evaluated`，产出的仍是旧宿主的结果。
   * 宿主真的变了（曲线被改、实体被编辑）就**重建那张图**——应用走的是"文档一变就重建"，
   * 这条边界是有意的：让 evaluator 每次从 `inputs` 里重新解析宿主会把几何解析拖进求值热路径。
   */
  setSource(id: string, value: unknown): void
  parameterValue(id: string): number | undefined
  /** 反向依赖闭包（含种子），按拓扑序返回。 */
  affectedNodes(changedIds: readonly string[]): readonly string[]
  /** 求值。不给 `changedIds` 就是全量；给了就只算反向依赖闭包。 */
  evaluate(changedIds?: readonly string[]): EvaluationReport
  result(id: string): EvaluationResult<unknown> | undefined
  value(id: string): unknown | undefined
  /** 当前所有失败节点的诊断（含参数写入被拒绝这类没有结果的失败）。 */
  diagnostics(): readonly ReactiveDiagnostic[]
  /** 环路径 `[a, b, ..., a]`；无环时为空数组。 */
  cycle(): readonly string[]
}

const declaredDependencies = (node: ReactiveNode): readonly string[] => node.kind === "source" || node.kind === "parameter" ? [] : node.dependsOn

export function createReactiveGraph(initial: readonly ReactiveNode[] = []): ReactiveGraph {
  const nodes = new Map<string, ReactiveNode>()
  /** 依赖图只负责拓扑序 / 脏闭包 / 环检测。自环在底层是构造期错误，在这里改由本层报告。 */
  const dependencies = createDependencyGraph()
  const selfReferential = new Set<string>()
  const results = new Map<string, EvaluationResult<unknown>>()
  /** 上一次求值时每个依赖的结果对象。逐一相同 ⇒ 输入未变 ⇒ 输出必然相同。 */
  const signatures = new Map<string, readonly unknown[]>()
  const currentDiagnostics = new Map<string, ReactiveDiagnostic>()
  /**
   * 被拒绝的参数写入（非有限值）。与 `currentDiagnostics` 分开存放：后者描述"求值结果"，
   * 每次成功的求值都会刷新它；而"你刚才那次写入被拒绝了"是个事件，必须留到一次合法写入为止。
   */
  const rejectedWrites = new Map<string, ReactiveDiagnostic>()

  const addNode = (node: ReactiveNode): void => {
    nodes.set(node.id, node)
    const declared = declaredDependencies(node)
    if (declared.includes(node.id)) selfReferential.add(node.id)
    else selfReferential.delete(node.id)
    dependencies.addNode(node.id, declared.filter((id) => id !== node.id))
    results.delete(node.id)
    signatures.delete(node.id)
    currentDiagnostics.delete(node.id)
    rejectedWrites.delete(node.id)
  }

  const removeNode = (id: string): void => {
    nodes.delete(id)
    dependencies.removeNode(id)
    results.delete(id)
    signatures.delete(id)
    currentDiagnostics.delete(id)
    rejectedWrites.delete(id)
    selfReferential.delete(id)
  }

  const topologicalOrder = (): readonly string[] => dependencies.topologicalOrder()
  const dependenciesOf = (id: string): readonly string[] => {
    const node = nodes.get(id)
    return node === undefined ? [] : declaredDependencies(node)
  }

  /** 反向依赖闭包。环上的节点与它们的下游不在拓扑序里，所以 `dirtyClosure` 会漏掉它们，这里补一轮 BFS。 */
  const closure = (seeds: readonly string[]): Set<string> => {
    const affected = new Set<string>()
    const queue: string[] = []
    const push = (id: string) => {
      if (!nodes.has(id) || affected.has(id)) return
      affected.add(id)
      queue.push(id)
    }
    for (const id of dependencies.dirtyClosure(seeds.filter((id) => nodes.has(id)))) push(id)
    for (const id of seeds) push(id)
    /**
     * **被删掉的种子**：底层依赖图在 `removeNode` 时会把反向边一起摘掉，于是"以被删对象的 id
     * 为种子"（拖动 / 删除 / 宿主消失在本切片里都是这个形状）的反向遍历到不了它原来的下游，
     * 闭包会变成空集，那些下游就会留着上一趟的过期值 —— 规格 §4.2 禁止用旧缓存伪装正常结果。
     * 所以这里自己扫一遍"谁声明依赖过这个 id"，把它们补进闭包（图很小，这一遍代价可忽略）。
     */
    for (const seed of seeds) {
      if (nodes.has(seed)) continue
      for (const [nodeId, node] of nodes) {
        if (declaredDependencies(node).includes(seed)) push(nodeId)
      }
    }
    for (let head = 0; head < queue.length; head += 1) for (const downstream of dependencies.dependentsOf(queue[head])) push(downstream)
    return affected
  }

  /**
   * 求值顺序 = 拓扑序（限定在"需要算的节点"内）+ 环上的节点（按插入顺序补在末尾）。
   * 后者永远不会执行 evaluator：它们只会得到 `dependency_cycle` 或从上游传播来的 `missing_source`。
   */
  const evaluationOrder = (needed: ReadonlySet<string>): string[] => {
    const ordered = topologicalOrder()
    const orderedSet = new Set(ordered)
    const tail = [...nodes.keys()].filter((id) => needed.has(id) && !orderedSet.has(id))
    return [...ordered.filter((id) => needed.has(id)), ...tail]
  }

  const storeFailure = (id: string, result: EvaluationResult<unknown>, produced: ReactiveDiagnostic[]): void => {
    results.set(id, result)
    signatures.delete(id)
    const diagnostic = diagnosticOf(result)!
    currentDiagnostics.set(id, diagnostic)
    produced.push(diagnostic)
  }

  const evaluate = (changedIds?: readonly string[]): EvaluationReport => {
    const cyclePath = dependencies.findCycle()
    const cycleMembers = new Set(cyclePath)
    const affected = changedIds === undefined ? new Set(nodes.keys()) : closure(changedIds)
    /**
     * 把受影响节点的**全部上游**也纳入顺序：增量求值时上游通常已有缓存，会因签名未变而被剪掉；
     * 但首次求值（图刚建好）或上游从未算过时，这一步保证 evaluator 读到的都是真值，而不是"还没算"。
     */
    const needed = new Set(affected)
    const pending = [...affected]
    while (pending.length > 0) {
      const id = pending.pop()!
      for (const upstream of dependenciesOf(id)) {
        if (!nodes.has(upstream) || needed.has(upstream)) continue
        needed.add(upstream)
        pending.push(upstream)
      }
    }
    const evaluated: string[] = []
    const reused: string[] = []
    /**
     * **被拒绝的写入**（`setParameter` 收到非有限值）不是"求值失败"，但它同样必须一直可见：
     * 调用者习惯写 `setParameter(x); evaluate([x])`，如果这条诊断交给 `currentDiagnostics`
     * 管理，紧接着的 `evaluate` 会（按"参数值有限"的正常分支）把它删掉 —— 于是"写入被拒绝"
     * 变成静默事件，接口承诺的 `diagnostics()` 也就成了空话。所以它独立存放，只有一次**合法**
     * 写入才能清掉它；本趟求值把闭包内的一切拒绝写入一并报出来（报告即读数）。
     */
    const diagnostics: ReactiveDiagnostic[] = [...rejectedWrites.entries()].filter(([id]) => needed.has(id)).map(([, diagnostic]) => diagnostic)

    for (const id of evaluationOrder(needed)) {
      const node = nodes.get(id)
      if (!node) continue
      // 来源 / 参数节点：值是外部写好的真值，没有 evaluator。
      if (node.kind === "source" || node.kind === "parameter") {
        const path = nonFinitePath(node.value)
        if (path !== null) {
          storeFailure(id, { status: "undefined", diagnostic: nonFiniteDiagnostic(id, path) }, diagnostics)
          continue
        }
        const existing = results.get(id)
        if (!existing || !isResolved(existing) || !Object.is(existing.value, node.value)) results.set(id, { status: "exact", value: node.value })
        currentDiagnostics.delete(id)
        continue
      }
      // 环：**先拒绝、再调用任何 evaluator**（规格 §4.2）。
      if (selfReferential.has(id)) {
        storeFailure(id, { status: "undefined", diagnostic: cycleMemberDiagnostic(id, [id, id]) }, diagnostics)
        continue
      }
      if (cycleMembers.has(id)) {
        storeFailure(id, { status: "undefined", diagnostic: cycleMemberDiagnostic(id, cyclePath) }, diagnostics)
        continue
      }
      const declared = declaredDependencies(node)
      const absent = declared.find((upstream) => !nodes.has(upstream))
      if (absent !== undefined) {
        storeFailure(id, { status: "undefined", diagnostic: missingSourceDiagnostic(id, absent) }, diagnostics)
        continue
      }
      const unusable = declared.find((upstream) => !isResolved(results.get(upstream)))
      if (unusable !== undefined) {
        const upstream = results.get(unusable)
        const state = upstream === undefined ? "尚未求值" : `状态为 ${upstream.status}`
        storeFailure(id, { status: "undefined", diagnostic: missingSourceDiagnostic(id, unusable, `上游 ${unusable} 没有可用值（${state}），无法求值。`) }, diagnostics)
        continue
      }
      const signature = declared.map((upstream) => results.get(upstream))
      const previous = signatures.get(id)
      if (previous !== undefined && previous.length === signature.length && previous.every((entry, index) => Object.is(entry, signature[index]))) {
        reused.push(id)
        continue
      }
      signatures.set(id, signature)
      const inputs = new Map<string, EvaluationResult<unknown>>()
      for (const upstream of declared) inputs.set(upstream, results.get(upstream) as EvaluationResult<unknown>)
      const result = runEvaluator(node, inputs)
      evaluated.push(id)
      if (isResolved(result)) {
        results.set(id, result)
        currentDiagnostics.delete(id)
      } else {
        const diagnostic = diagnosticOf(result)!
        results.set(id, result)
        currentDiagnostics.set(id, diagnostic)
        diagnostics.push(diagnostic)
      }
    }

    const values = new Map<string, unknown>()
    for (const [id, result] of results) if (isResolved(result)) values.set(id, result.value)
    return { evaluated, reused, diagnostics, values }
  }

  const graph: ReactiveGraph = {
    addNode,
    removeNode,
    hasNode: (id) => nodes.has(id),
    nodeIds: () => [...nodes.keys()],
    node: (id) => nodes.get(id),
    setParameter(id, value) {
      const node = nodes.get(id)
      if (!node || node.kind !== "parameter") {
        const diagnostic = missingSourceDiagnostic(id, id, `没有这个参数节点：${id}`)
        currentDiagnostics.set(id, diagnostic)
        return { status: "undefined", diagnostic }
      }
      if (!Number.isFinite(value)) {
        // 非有限参数一律拒绝：写进去会让所有下游一起变成 NaN，而且再也拖不回来。
        // 拒绝**不是**一次成功写入：报 `exact` + 旧值会让调用方以为参数已经变成这个值了。
        const diagnostic = nonFiniteDiagnostic(id, "value", `参数 ${id} 必须是有限数。`)
        rejectedWrites.set(id, diagnostic)
        currentDiagnostics.delete(id)
        return { status: "undefined", diagnostic }
      }
      nodes.set(id, { ...node, value })
      const existing = results.get(id)
      if (!existing || !isResolved(existing) || !Object.is(existing.value, value)) results.set(id, { status: "exact", value })
      currentDiagnostics.delete(id)
      // 只有一次**合法**写入才算把"上次被拒绝"这件事解决掉。
      rejectedWrites.delete(id)
      return results.get(id) as EvaluationResult<number>
    },
    parameterValue(id) {
      const node = nodes.get(id)
      return node?.kind === "parameter" ? node.value : undefined
    },
    setSource(id, value) {
      const node = nodes.get(id)
      if (!node || node.kind !== "source") {
        currentDiagnostics.set(id, missingSourceDiagnostic(id, id, `没有这个来源节点：${id}`))
        return
      }
      nodes.set(id, { ...node, value })
      const existing = results.get(id)
      if (!existing || !isResolved(existing) || !Object.is(existing.value, value)) results.set(id, { status: "exact", value })
      currentDiagnostics.delete(id)
    },
    affectedNodes: (changedIds) => evaluationOrder(changedIds === undefined ? new Set(nodes.keys()) : closure(changedIds)),
    evaluate,
    result: (id) => results.get(id),
    value: (id) => resolvedValue(results.get(id)),
    diagnostics: () => [...new Map([...currentDiagnostics, ...rejectedWrites]).values()],
    cycle: () => {
      const found = dependencies.findCycle()
      if (found.length > 0) return found
      const selfCycle = [...selfReferential][0]
      return selfCycle === undefined ? [] : [selfCycle, selfCycle]
    }
  }

  for (const node of initial) addNode(node)
  return graph
}
