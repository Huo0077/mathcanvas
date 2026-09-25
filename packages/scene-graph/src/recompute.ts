import type { GeometryDocument, Measurement3, PrimitiveSpec } from "@draw/dsl"
import { evaluateLineParameters, entityResolverFor, evaluateParameterExpressions, evaluatePlanarMeasurement, intersectSampledPrimitives, placedConic, solveLineConstraints, triangleCenter2, triangleRadius2, calculateMeasurement3, type PlanarMetric, type PlaceableConic } from "@draw/geometry-kernel"
import { curveRotationPivotId, placementResolver } from "./curveRotation"
import { isPlaceableConic } from "./primitiveKinds"
import { recomputeIntersectionFace, recomputeIntersectionLine, recomputeIntersectionPoint3, recomputeIntersectionSolid, recomputeSection } from "./sectionRecompute"
import { MIN_DYNAMIC_CIRCLE_RADIUS, recomputeAnalysisSet, recomputeCurveTangent, recomputeDerivative, recomputeIntegral, recomputeSecant, recomputeTangent, sampledSource } from "./analysisRecompute"
import { resolveBoundPoint, resolveBoundPoint3, resolveIntersection, syncTemplateTopology } from "./resolve3d"
import { getAffectedPrimitiveIds, topologicalRecomputeOrder } from "./graph"

/**
 * **重算主族**（从 `operations.ts` 拆出，评审方案 2）。
 *
 * `recomputeDerivedObjects` 是"改了一处之后，把该跟着变的对象按拓扑序重算一遍"的唯一入口；它内部有
 * 两个**嵌套**函数：`pickSolution`（多解里挑离 hint 最近的解，吸引域语义）与 `recomputePrimitive`
 *（单个对象的重算分发）。**嵌套是刻意的** —— 它们要闭包持有 `primitiveMap` 与 `parameters`，
 * 每算完一个对象就就地更新，好让下游读到刚算出来的上游值，而不是本趟开始前的快照。
 * 搬动因此**逐行原样、且只导出外层那一个**：给嵌套函数加 `export` 在语法上非法
 *（前一轮踩过 `TS1184: Modifiers cannot appear here`）。
 *
 * 两条口径随代码搬走：**按拓扑序遍历**（顺序错了下游会拿到上一轮的中间值）；
 * **重算幂等**（同一份文档反复重算得到同一份结果，`recomputeConsistency.test.ts` 钉住）。
 */

export function recomputeDerivedObjects(document: GeometryDocument, changedIds?: string[]): GeometryDocument {
  const parameters = evaluateParameterExpressions(document.parameters)
  const evaluatedDocument = {
    ...document,
    parameters,
    primitives: document.primitives.map((primitive) => primitive.type === "line" ? evaluateLineParameters({ ...document, parameters }, primitive) : primitive)
  }
  /**
   * 把"绕定点旋转"落进曲线自己的几何，**在取快照之前**做一次。
   *
   * 这样做的好处是：后面所有消费者（路径约束、采样、包围盒、平移）读到的都是放置后的曲线，
   * 于是它们一行都不用改 —— "圆过定点"对它们就是一个普通的圆。
   * `evaluatedDocument` 是本次重算的工作副本（`...document` 的新对象），改它不会碰到调用方那份。
   */
  const placementOf = placementResolver(evaluatedDocument.primitives)
  for (let index = 0; index < evaluatedDocument.primitives.length; index += 1) {
    const primitive = evaluatedDocument.primitives[index]
    if (!isPlaceableConic(primitive)) continue
    evaluatedDocument.primitives[index] = placedConic(primitive as PlaceableConic, placementOf(primitive))
  }
  const affected = changedIds === undefined
    ? new Set(document.primitives.map((primitive) => primitive.id))
    : getAffectedPrimitiveIds(document, changedIds)
  /**
   * 定点是**点图元**时，定点动了 = 曲线动了。
   *
   * 这条边不能只写在依赖图里：`recomputeDerivedObjects(document, ["pivot-1"])` 的脏集来自
   * `getAffectedPrimitiveIds`，曲线不在里面就不会被重建一次，放置也就永远不会刷新。
   */
  if (changedIds !== undefined) {
    const changed = new Set(changedIds)
    for (const primitive of document.primitives) {
      const pivotId = curveRotationPivotId(primitive)
      if (pivotId && changed.has(pivotId)) affected.add(primitive.id)
    }
  }
  const projectedPrimitives = [...evaluatedDocument.primitives]
  const projectedLines = new Map(
    projectedPrimitives
      .filter((primitive): primitive is Extract<PrimitiveSpec, { type: "line" }> => primitive.type === "line")
      .map((line) => [line.id, line])
  )
  const activeLineIds = changedIds === undefined
    ? undefined
    : new Set([...affected].filter((id) => projectedLines.has(id)))
  const activeConstraintIds = changedIds === undefined
    ? undefined
    : new Set(evaluatedDocument.constraints
      .filter((constraint) => constraint.targets.length === 2 && constraint.targets.every((target) => affected.has(target)))
      .map((constraint) => constraint.id))
  const solved = solveLineConstraints(projectedLines, evaluatedDocument.constraints, undefined, undefined, changedIds === undefined ? undefined : activeLineIds, activeConstraintIds)
  // 退化直线（两端点重合）上的平行 / 垂直 / 共线无法求解，`unsatisfiable` 会列出这些约束：
  // 求解失败时把原因说清楚，而不是笼统地报"未收敛"。
  if (!solved.converged) throw new Error(solved.unsatisfiable.length > 0
    ? `constraint solving failed: target line is degenerate (${solved.unsatisfiable.join(", ")})`
    : "constraint solving failed to converge")
  const lines = solved.lines
  const primitiveIndexById = new Map(projectedPrimitives.map((primitive, index) => [primitive.id, index]))
  for (const [id, projected] of lines) {
    const primitiveIndex = primitiveIndexById.get(id)
    if (primitiveIndex !== undefined) projectedPrimitives[primitiveIndex] = projected
  }
  // 受约束的 point3 不再需要"最多重跑 N 遍直到不动"的多趟循环：
  // 主重算按拓扑序走，且每算完一个对象就更新查找表，一趟即可收敛。
  syncTemplateTopology(projectedPrimitives, changedIds === undefined ? undefined : new Set(changedIds))
  const primitiveMap = new Map(projectedPrimitives.map((primitive) => [primitive.id, primitive]))
  /**
   * 圆的查找是**活引用**而不是快照。
   *
   * 圆心 / 半径现在可以由点图元驱动（见 `recomputePrimitive` 里的圆分支），于是圆会在主循环**当中**被改写。
   * 快照地图会让"直线与这个圆的交点"读到改写之前的旧圆 —— 用户看到的就是交点慢一帧、甚至粘在旧位置上。
   * 判据是拓扑序里圆一定排在它的驱动点之后，因此这里读到的永远是刚算出来的那一份。
   */
  const circleOf = (id: string): Extract<PrimitiveSpec, { type: "circle" }> | undefined => {
    const candidate = primitiveMap.get(id)
    return candidate?.type === "circle" ? candidate : undefined
  }
  /**
   * 重算单个对象。返回 `undefined` 表示这个类型不参与本趟重算。
   *
   * 抽成函数是为了让主循环按**拓扑序**遍历，并在每算完一个对象后立刻更新 `primitiveMap` ——
   * 这样下游读到的是刚刚算出来的上游值，而不是本趟开始前的那份快照。
   */
  /**
 * 从多解里挑一个：
 * - 有 `hint` 时取**离 hint 最近的解**——解的数量或顺序随形状变化时不会串位（吸引域语义，与 SolveSpace 一致）；
 * - 没有 hint 时退回下标；下标越界取最后一个，而不是静默回到第 0 个。
 * 调用方会把选中的解写回 `hint`，于是下一次重算继续跟着它。
 */
function pickSolution<T extends { x: number; y: number }>(points: T[], solutionIndex: number | undefined, hint: { x: number; y: number } | undefined): T | null {
  if (points.length === 0) return null
  if (hint) {
    let best = points[0]
    let bestDistance = Math.hypot(best.x - hint.x, best.y - hint.y)
    for (const candidate of points.slice(1)) {
      const distance = Math.hypot(candidate.x - hint.x, candidate.y - hint.y)
      if (distance < bestDistance) {
        best = candidate
        bestDistance = distance
      }
    }
    return best
  }
  const index = Number.isInteger(solutionIndex) && (solutionIndex ?? 0) >= 0 ? (solutionIndex as number) : 0
  return points[Math.min(index, points.length - 1)]
}

const recomputePrimitive = (primitive: PrimitiveSpec): PrimitiveSpec | undefined => {
    if (primitive.type === "point3" && primitive.binding) {
      const position = resolveBoundPoint3(primitive, primitiveMap, parameters)
      return position ? { ...primitive, position } : undefined
    }
    if (primitive.type === "point" && primitive.binding) {
      const point = resolveBoundPoint(primitive.binding, primitiveMap, parameters)
      return point ? { ...primitive, x: point.x, y: point.y } : undefined
    }
    /**
     * **由三角形派生的圆**（内切圆 / 外接圆，设计规格 §4.3）。
     *
     * 圆心与半径都从那个三角形算出来：`inradius` → 内心 + 内切半径，`circumradius` → 外心 + 外接半径。
     * 几何来自内核的 `triangleCenter2` / `triangleRadius2`，与 Reactive DAG 的三角形中心节点**同一份**。
     *
     * 顶点缺失或三点共线时**保留上一次的几何**：文档层不伪造坐标（与"宿主解析不了就保持不动"
     * 是既有约定），退化 / 缺失来源的结构化诊断由 Reactive DAG 那一层报。
     */
    if (primitive.type === "circle" && primitive.radiusFrom?.kind === "triangle") {
      const rule = primitive.radiusFrom
      const vertices = rule.triangleIds.map((id) => primitiveMap.get(id))
      const points = vertices.map((vertex) => vertex?.type === "point" ? { x: vertex.x, y: vertex.y } : null)
      if (points.every((point) => point !== null)) {
        const [first, second, third] = points as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }]
        const center = triangleCenter2(rule.metric === "inradius" ? "incenter" : "circumcenter", first, second, third)
        const radius = triangleRadius2(rule.metric, first, second, third)
        if (center.status === "exact" && radius.status === "exact") {
          const bounded = Math.max(MIN_DYNAMIC_CIRCLE_RADIUS, radius.value)
          if (center.value.x === primitive.center.x && center.value.y === primitive.center.y && bounded === primitive.radius) return primitive
          return { ...primitive, center: center.value, radius: bounded }
        }
      }
      return primitive
    }
    /**
     * 以点图元为圆心 / 半径随点图元变化的圆。
     *
     * 用户口径："第二动点能够作为圆心作圆，圆的半径能够调节，也能够根据动点位置进行动态变化。"
     * `center` 与 `radius` 在这里是**派生缓存**，真值是那两个点图元（`centerPointId` / `radiusFrom`）。
     *
     * 写在主循环里、而不是像"绕定点旋转"那样放在预扫描里，是因为它必须读到**刚算出来的**点坐标：
     * 预扫描读的是本趟开始前的快照，拖动时会慢一帧，用户看到圆心追着点跑。
     * 依赖图里已经声明了"点 → 圆"这条边，所以拓扑序保证点一定排在圆前面。
     */
    if (primitive.type === "circle" && (primitive.centerPointId || primitive.radiusFrom)) {
      const centerPoint = primitive.centerPointId ? primitiveMap.get(primitive.centerPointId) : undefined
      const center = centerPoint?.type === "point" ? { x: centerPoint.x, y: centerPoint.y } : primitive.center
      // 三角形规则在上面已经返回；这里只剩"半径 = 驱动点距离 × 倍率"这一支。
      const distanceRule = primitive.radiusFrom?.kind === "triangle" ? undefined : primitive.radiusFrom
      const driver = distanceRule ? primitiveMap.get(distanceRule.pointId) : undefined
      // 驱动点与圆心重合时半径会变成 0（圆消失），但 schema 要求 radius > 0：
      // 给一个不可见的下限，宁可画出一个极小的圆，也不要让文档存不下去。
      const radius = driver?.type === "point" && distanceRule
        ? Math.max(MIN_DYNAMIC_CIRCLE_RADIUS, Math.hypot(driver.x - center.x, driver.y - center.y) * distanceRule.factor)
        : primitive.radius
      if (center.x === primitive.center.x && center.y === primitive.center.y && radius === primitive.radius) return primitive
      return { ...primitive, center, radius }
    }
    if (primitive.type === "derivative") {
      const source = primitiveMap.get(primitive.sourceId)
      if (source?.type !== "function") return { ...primitive, points: [], status: "failed" as const, diagnostic: "derivative source function is missing" }
      return recomputeDerivative(primitive, source, parameters)
    }
    if (primitive.type === "tangent" || primitive.type === "normal" || primitive.type === "secant") {
      const source = primitiveMap.get(primitive.sourceId)
      /**
       * **有 `anchor` 就走曲线路径，与来源是不是函数无关。**
       *
       * 这一点很容易写错：函数图像也是动点可以绑定的轨道（`dynamicPointPaths` 里就有它），
       * 所以"在动点处作切线"完全可能落在一个函数图像上。如果按"来源是函数"优先分派，
       * 那条切线会被当成旧的横坐标定位切线，`anchor` 被静默忽略 ——
       * 表现就是"切出来了，但拖不动点，切线不动"。
       *
       * 判据必须写成 `type !== "secant"`（先按判别式收窄）而不是 `type === "tangent" || ...`：
       * `SecantPrimitive` 没有 `anchor` 这个字段，直接读它连类型都过不了。
       */
      if (source && primitive.type !== "secant" && primitive.anchor) return recomputeCurveTangent(primitive, source, primitiveMap, parameters)
      if (source?.type === "function") {
        return primitive.type === "secant" ? recomputeSecant(primitive, source, parameters) : recomputeTangent(primitive, source, parameters)
      }
      // 曲线来源（圆 / 圆弧 / 抛物线 / 椭圆 / 双曲线）没有 `anchor` 时无从确定切点，只能如实报错。
      return { ...primitive, status: "failed" as const, diagnostic: "derived line source curve is missing" }
    }
    if (primitive.type === "integral" || primitive.type === "analysisSet") {
      const source = primitiveMap.get(primitive.sourceId)
      if (source?.type !== "function") return { ...primitive, status: "failed" as const, diagnostic: "analysis source function is missing" }
      return primitive.type === "integral" ? recomputeIntegral(primitive, source, parameters) : recomputeAnalysisSet(primitive, source, parameters)
    }
    if (primitive.type === "section") {
      const source = primitiveMap.get(primitive.sourceId)
      if (!source) return { ...primitive, points: [], classification: "insufficient-data" as const, status: "failed" as const, visible: false, diagnostic: "截面来源实体不存在。" }
      return recomputeSection(primitive, source, primitiveMap)
    }
    if (primitive.type === "intersectionLine") return recomputeIntersectionLine(primitive, primitiveMap)
    if (primitive.type === "intersectionSolid") return recomputeIntersectionSolid(primitive, primitiveMap)
    if (primitive.type === "intersectionFace") return recomputeIntersectionFace(primitive, primitiveMap)
    if (primitive.type === "intersectionPoint3") return recomputeIntersectionPoint3(primitive, primitiveMap)
    if (primitive.type === "line") return lines.get(primitive.id)
    if (primitive.type === "intersectionSet") {
      const first = sampledSource(primitive.objectA, primitiveMap)
      const second = sampledSource(primitive.objectB, primitiveMap)
      if (!first || !second) throw new Error("intersection set references unsupported objects")
      const result = intersectSampledPrimitives(first, second)
      if (result.kind === "degenerate") throw new Error(`degenerate intersection set: ${result.reason}`)
      if (result.kind === "none" || result.kind === "coincident") return { ...primitive, points: [], visible: false }
      if (result.kind === "point" || result.kind === "tangent") return { ...primitive, points: [result.point], visible: true }
      return { ...primitive, points: result.points, visible: true }
    }
    if (primitive.type === "curveIntersection") {
      const first = sampledSource(primitive.objectA, primitiveMap)
      const second = sampledSource(primitive.objectB, primitiveMap)
      if (!first || !second) throw new Error("curve intersection references unsupported objects")
      const result = intersectSampledPrimitives(first, second)
      if (result.kind === "degenerate") throw new Error(`degenerate curve intersection: ${result.reason}`)
      if (result.kind === "none" || result.kind === "coincident") return { ...primitive, visible: false }
      if (result.kind === "point" || result.kind === "tangent") return { ...primitive, x: result.point.x, y: result.point.y, visible: true }
      const point = pickSolution(result.points, primitive.solutionIndex, primitive.hint)
      return point ? { ...primitive, x: point.x, y: point.y, hint: { x: point.x, y: point.y }, visible: true } : { ...primitive, visible: false }
    }
    if (primitive.type !== "intersection" && primitive.type !== "lineCircleIntersection" && primitive.type !== "circleIntersection") return undefined
    const result = resolveIntersection(primitive, lines, circleOf)
    if (result.kind === "degenerate") throw new Error(`degenerate intersection: ${result.reason}`)
    if (result.kind === "none" || result.kind === "coincident") return { ...primitive, visible: false }
    if (result.kind === "point" || result.kind === "tangent") return { ...primitive, x: result.point.x, y: result.point.y, visible: true }
    const point = primitive.type === "intersection" ? result.points[0] : pickSolution(result.points, primitive.solutionIndex, primitive.hint)
    if (!point) return { ...primitive, visible: false }
    return primitive.type === "intersection"
      ? { ...primitive, x: point.x, y: point.y, visible: true }
      : { ...primitive, x: point.x, y: point.y, hint: { x: point.x, y: point.y }, visible: true }
  }
  const primitives = [...projectedPrimitives]
  for (const id of topologicalRecomputeOrder(evaluatedDocument, changedIds)) {
    const index = primitiveIndexById.get(id)
    if (index === undefined) continue
    const recomputed = recomputePrimitive(primitives[index])
    if (recomputed === undefined || recomputed === primitives[index]) continue
    primitives[index] = recomputed
    // 关键：下游对象必须看到刚算出来的上游值，而不是本趟开始前的快照。
    primitiveMap.set(id, recomputed)
  }
  // 测量只在它的来源对象真的进了脏集时才重算 —— 这是依赖图剪枝在测量上的体现。
  // 来源都没变时保留上一次的读数（值本身就存在文档里），所以"拖一个和它无关的点"不会触发它。
  const measurements = evaluatedDocument.measurements.map((measurement) => {
    if (changedIds !== undefined && !measurement.sourceIds.some((id) => affected.has(id))) return measurement
    return evaluatedDocument.workspace === "geometry3d"
      ? calculateMeasurement3(measurement, primitives)
      : calculatePlanarMeasurement(measurement, primitives)
  })
  return { ...evaluatedDocument, primitives, measurements }
}

/**
 * 平面（2D）测量。
 *
 * 复用 `Measurement3` 这个既有容器，而不是新增一套 DSL 类型：`Measurement3Metric` 已经包含
 * length / distance / angle / area，状态枚举也与内核的 `MeasurementStatus` 逐字一致，
 * 因此归档格式、对象列表、检查器和导出器都不需要改动。求值则交给内核的 `evaluatePlanarMeasurement`，
 * 由它负责退化判定（重合点、零向量、三点共线）与 atan2 角度。
 *
 * 两处映射：
 * - `dihedralKind`（interior / exterior）同时承载平面角的取角方式，沿用已有的按钮签名；
 * - 平面量的值都是数值计算的，所以 `precision` 固定为 `numeric-approximation`。
 */
export function calculatePlanarMeasurement(measurement: Measurement3, primitives: PrimitiveSpec[]): Measurement3 {
  /**
   * 来源解析成**实体**（点 / 线 / 圆），不再只喂点表：平面测量要能算"切线与直线的夹角""动圆的面积"。
   * `connection` 只存两个点 id，先补成一条真实线段再交给内核。
   */
  const primitiveMap = new Map(primitives.map((primitive) => [primitive.id, primitive]))
  const resolve = entityResolverFor(
    primitives.map((primitive) => {
      if (primitive.type !== "connection") return primitive
      const start = primitiveMap.get(primitive.startPointId)
      const end = primitiveMap.get(primitive.endPointId)
      if (start?.type !== "point" || end?.type !== "point") return primitive
      return { id: primitive.id, type: "segment" as const, a: { x: start.x, y: start.y }, b: { x: end.x, y: end.y } }
    })
  )
  const reading = evaluatePlanarMeasurement({
    id: measurement.id,
    metric: measurement.metric as PlanarMetric,
    sourceIds: measurement.sourceIds,
    angleKind: measurement.dihedralKind === "exterior" ? "exterior" : "interior"
  }, resolve)
  return {
    ...measurement,
    value: reading.value ?? undefined,
    unit: reading.unit,
    status: reading.status,
    precision: "numeric-approximation",
    explanation: reading.explanation
  }
}
