/**
 * 响应式依赖图（Reactive Dependency Graph）
 *
 * 动态几何的核心问题是"雪崩式更新"：
 *
 *     P 动 → 直线 AP 的斜率变 → AP 与圆 C 的交点 Q 变 → △APQ 的面积变
 *
 * 这条链必须**按依赖顺序**重算，而且每一步只算一次。本模块提供两件东西：
 *
 *   1. `DependencyGraph` —— 有向无环图的拓扑结构：拓扑排序、脏闭包、环检测；
 *   2. `ReactiveGraph<T>` —— 带值缓存与**剪枝**的重算调度器。
 *
 * ## 为什么"按文档顺序重算一遍"是不够的
 *
 * 现存实现是"取所有受影响对象，按数组顺序各重算一次"。它只在**对象恰好按依赖顺序创建**时正确；
 * 一旦后创建的对象被先创建的对象依赖（例如先画圆 C，再在其上取动点 P，再把 C 改成由 P 派生），
 * 单趟遍历就会用到过期的上游值。现存代码里 `recomputeBoundPoint3s` 之所以要"最多重跑 N 遍直到不动"，
 * 正是缺拓扑序的症状 —— 用拓扑序可以一趟算完，且能证明没有冗余。
 *
 * ## 脏检查的复杂度
 *
 *   脏闭包   O(V + E)   —— 从变更点沿 dependents 边做 BFS
 *   拓扑序   O(V + E)   —— Kahn 算法，缓存到结构变化为止
 *   重算     O(脏集)    —— 按全局拓扑序**过滤**脏集，而不是对脏集重新排序
 *
 * 第三步是关键：脏集是全局拓扑序的子序列，所以"过滤"天然给出依赖优先的顺序，
 * 不需要每次拖拽都重跑一遍拓扑排序。
 */

export interface DependencyGraph {
  readonly size: number
  /** 结构版本号。结构变化（增删点/边）时自增，可用于失效缓存。 */
  readonly version: number
  has(id: string): boolean
  ids(): readonly string[]
  addNode(id: string, dependsOn?: readonly string[]): void
  removeNode(id: string): void
  setDependencies(id: string, dependsOn: readonly string[]): void
  dependenciesOf(id: string): readonly string[]
  dependentsOf(id: string): readonly string[]
  /** 全局拓扑序：任一节点的依赖都排在它前面。有环的节点不会出现在结果里。 */
  topologicalOrder(): readonly string[]
  /** 与 `changedIds` 相连的全部下游（含种子），按拓扑序返回。 */
  dirtyClosure(changedIds: readonly string[]): string[]
  /** 找不到环时返回空数组；否则返回一条具体的环路径 `[a, b, ..., a]`。 */
  findCycle(): string[]
}

export function createDependencyGraph(): DependencyGraph {
  /** 上游：id → 它依赖的 id 集合。 */
  const dependencies = new Map<string, Set<string>>()
  /** 下游：id → 依赖它的 id 集合。拖拽时沿这个方向做 BFS。 */
  const dependents = new Map<string, Set<string>>()
  /** 插入顺序。Kahn 算法用它做稳定的平局裁决，保证同一份文档每次得到同一个拓扑序。 */
  const insertionOrder: string[] = []
  let structureVersion = 0
  let cachedOrder: string[] | null = null

  const invalidate = () => {
    cachedOrder = null
    structureVersion += 1
  }

  const ensure = (id: string) => {
    if (!dependencies.has(id)) {
      dependencies.set(id, new Set())
      dependents.set(id, new Set())
      insertionOrder.push(id)
      invalidate()
    }
  }

  const detach = (id: string, upstream: string) => {
    dependencies.get(id)?.delete(upstream)
    dependents.get(upstream)?.delete(id)
  }

  const graph: DependencyGraph = {
    get size() {
      return dependencies.size
    },
    get version() {
      return structureVersion
    },
    has: (id) => dependencies.has(id),
    ids: () => [...insertionOrder],
    addNode(id, dependsOn = []) {
      ensure(id)
      for (const upstream of dependsOn) {
        if (upstream === id) throw new Error(`dependency cycle: node ${id} cannot depend on itself`)
        ensure(upstream)
        if (dependencies.get(id)!.has(upstream)) continue
        dependencies.get(id)!.add(upstream)
        dependents.get(upstream)!.add(id)
        invalidate()
      }
    },
    removeNode(id) {
      if (!dependencies.has(id)) return
      for (const upstream of [...dependencies.get(id)!]) detach(id, upstream)
      for (const downstream of [...dependents.get(id)!]) detach(downstream, id)
      dependencies.delete(id)
      dependents.delete(id)
      insertionOrder.splice(insertionOrder.indexOf(id), 1)
      invalidate()
    },
    setDependencies(id, dependsOn) {
      ensure(id)
      for (const upstream of [...dependencies.get(id)!]) detach(id, upstream)
      graph.addNode(id, dependsOn)
    },
    dependenciesOf: (id) => [...(dependencies.get(id) ?? [])],
    dependentsOf: (id) => [...(dependents.get(id) ?? [])],

    topologicalOrder() {
      if (cachedOrder) return cachedOrder
      // Kahn：入度为 0 的节点按插入顺序入队，出队即写入结果，并把下游入度减一。
      const indegree = new Map<string, number>()
      for (const id of insertionOrder) indegree.set(id, dependencies.get(id)!.size)
      const queue = insertionOrder.filter((id) => indegree.get(id) === 0)
      const order: string[] = []
      for (let head = 0; head < queue.length; head += 1) {
        const id = queue[head]
        order.push(id)
        for (const downstream of dependents.get(id)!) {
          const next = (indegree.get(downstream) ?? 0) - 1
          indegree.set(downstream, next)
          if (next === 0) queue.push(downstream)
        }
      }
      cachedOrder = order
      return order
    },

    dirtyClosure(changedIds) {
      const dirty = new Set<string>()
      const queue: string[] = []
      for (const id of changedIds) {
        if (!dependencies.has(id) || dirty.has(id)) continue
        dirty.add(id)
        queue.push(id)
      }
      for (let head = 0; head < queue.length; head += 1) {
        for (const downstream of dependents.get(queue[head])!) {
          if (dirty.has(downstream)) continue
          dirty.add(downstream)
          queue.push(downstream)
        }
      }
      // 用全局拓扑序过滤脏集：顺序天然正确，且不需要对脏集单独排序。
      return graph.topologicalOrder().filter((id) => dirty.has(id))
    },

    findCycle() {
      const order = graph.topologicalOrder()
      const ordered = new Set(order)
      if (ordered.size === dependencies.size) return []
      const state = new Map<string, 0 | 1 | 2>()
      const stack: string[] = []
      const visit = (id: string): string[] | null => {
        if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id]
        if (state.get(id) === 2) return null
        state.set(id, 1)
        stack.push(id)
        for (const upstream of dependencies.get(id)!) {
          const found = visit(upstream)
          if (found) return found
        }
        stack.pop()
        state.set(id, 2)
        return null
      }
      for (const id of insertionOrder) {
        if (ordered.has(id)) continue
        const found = visit(id)
        if (found) return found
      }
      return []
    }
  }

  return graph
}

// ---------------------------------------------------------------------------
// 带值缓存的重算调度器
// ---------------------------------------------------------------------------

export interface ReactiveNode<T> {
  id: string
  dependsOn: readonly string[]
  compute(inputs: ReadonlyMap<string, T>): T
  /**
   * 相等判定。返回 true 表示"这一步的结果没有变化"，于是**它的下游全部被剪掉**。
   * 这是"无冗余重算"的关键：一次拖拽里斜率可能没变，就不该继续算交点与面积。
   * 缺省用 `Object.is`。
   */
  equals?(next: T, previous: T): boolean
}

export interface ReactiveUpdateReport {
  /** 按拓扑序真正执行了 `compute` 的节点。 */
  recomputed: string[]
  /** 因为所有上游都没变（或被剪掉）而跳过的节点。 */
  pruned: string[]
  /** 计算抛异常的节点，以及它们的异常。异常节点的下游一律被剪掉。 */
  errors: Map<string, Error>
}

export interface ReactiveGraph<T> {
  readonly graph: DependencyGraph
  /** 外部写入一个节点的当前值，用于"源节点"（参数、被拖动的点）。 */
  setValue(id: string, value: T): void
  value(id: string): T | undefined
  values(): ReadonlyMap<string, T>
  /**
   * 重算。
   *
   * `changedIds` 里的节点被视为"值刚刚被外部写好了"，只向下游传播，不重新 `compute`；
   * 其余处于脏闭包中的节点按拓扑序重算，并在结果未变时剪掉自己的下游。
   */
  update(changedIds: readonly string[]): ReactiveUpdateReport
  /** 不依赖任何变更，全量重算一遍（首次构建 / 载入文档时使用）。 */
  recomputeAll(): ReactiveUpdateReport
  /** 只读快照，UI 层直接读这个。 */
  snapshot(): ReadonlyMap<string, T>
}

export function createReactiveGraph<T>(nodes: readonly ReactiveNode<T>[]): ReactiveGraph<T> {
  const graph = createDependencyGraph()
  for (const node of nodes) graph.addNode(node.id, node.dependsOn)
  const cycle = graph.findCycle()
  if (cycle.length > 0) throw new Error(`dependency cycle: ${cycle.join(" -> ")}`)

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const values = new Map<string, T>()
  const pristine = new Set<string>()

  const equals = (node: ReactiveNode<T>, next: T, previous: T): boolean => {
    if (previous === undefined && !values.has(node.id)) return false
    return node.equals ? node.equals(next, previous) : Object.is(next, previous)
  }

  const run = (changedIds: readonly string[], forceAll = false): ReactiveUpdateReport => {
    const seeds = new Set(changedIds.filter((id) => byId.has(id)))
    // forceAll：没有任何"外部刚写好"的种子，每个节点都按拓扑序自己算一遍。
    const dirty = forceAll ? graph.topologicalOrder() : graph.dirtyClosure([...seeds])
    const recomputed: string[] = []
    const pruned: string[] = []
    const errors = new Map<string, Error>()
    const skip = new Set<string>()

    for (const id of dirty) {
      const node = byId.get(id)
      if (!node) continue
      // 上游被剪掉 / 算错，这一步就不该执行 —— 否则会用到过期值，且可能把异常扩散出去。
      if (node.dependsOn.some((upstream) => skip.has(upstream))) {
        pruned.push(id)
        skip.add(id)
        continue
      }
      if (!forceAll && seeds.has(id)) {
        // 种子值已由调用方写好，这里只做传播起点。
        pristine.delete(id)
        continue
      }
      const inputs = new Map<string, T>()
      for (const upstream of node.dependsOn) inputs.set(upstream, values.get(upstream) as T)
      try {
        const previous = values.get(id) as T
        const next = node.compute(inputs)
        if (pristine.has(id) || !equals(node, next, previous)) {
          values.set(id, next)
          pristine.delete(id)
          recomputed.push(id)
        } else {
          pruned.push(id)
          skip.add(id)
        }
      } catch (error) {
        errors.set(id, error instanceof Error ? error : new Error(String(error)))
        // 值保持上一次的结果：宁可显示过期数据，也不要让一个坏节点把整张图清空。
        skip.add(id)
      }
    }
    return { recomputed, pruned, errors }
  }

  return {
    graph,
    setValue(id, value) {
      values.set(id, value)
      pristine.delete(id)
    },
    value: (id) => values.get(id),
    values: () => values,
    update: run,
    recomputeAll() {
      // 全量重算：所有节点都标成"没算过"，并强制每个节点执行自己的 compute
      // （源节点没有上游，它的值只能来自 compute，靠 setValue 的种子语义会漏掉它）。
      for (const id of graph.ids()) pristine.add(id)
      return run([], true)
    },
    snapshot: () => new Map(values)
  }
}

/** 便于把"节点表"按依赖分批。返回的每一批可以并行计算（批内互不依赖）。 */
export function topologicalLayers(graph: DependencyGraph): string[][] {
  const depth = new Map<string, number>()
  for (const id of graph.topologicalOrder()) {
    const upstream = graph.dependenciesOf(id)
    depth.set(id, upstream.length === 0 ? 0 : Math.max(...upstream.map((parent) => (depth.get(parent) ?? 0) + 1)))
  }
  const layers: string[][] = []
  for (const id of graph.topologicalOrder()) {
    const level = depth.get(id) ?? 0
    ;(layers[level] ??= []).push(id)
  }
  return layers
}
