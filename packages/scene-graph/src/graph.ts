import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { createDependencyGraph } from "@draw/geometry-kernel"
import { curveRotationPivotId } from "./curveRotation"
import { isPlaceableConic, isSourceIdConstruction } from "./primitiveKinds"

/**
 * **依赖图**（从 `operations.ts` 拆出，评审方案 2）。
 *
 * 这一族回答"改一个图元，谁要跟着重算、按什么顺序"：`primitiveDependencies` 算一个图元的直接依赖，
 * `templateRelations` 补上"实体 ↔ 物化子对象"两个方向，`getDependencyIndex` 汇总成索引，
 * `getAffectedPrimitiveIds` 取传递闭包，`topologicalRecomputeOrder` 给出拓扑序。
 *
 * 两条**实测出来**的口径随代码一起搬过来（别删）：
 * 1. 依赖图原先只有"多面体依赖它的点 / 棱 / 面 + 模板源"这一个方向，于是"实体 → 子对象"这条边
 *    根本不存在 —— 把点绑在立方体的某个面上再移动立方体时，**绑定点留在原地**（实测现场，
 *    见 `templateRelations` 的注释）；
 * 2. 截面 / 交面 / 交线的来源写的是**实体本身**，而实体的几何全在物化拓扑里 —— 只声明依赖实体，
 *    按数值改一个顶点就无法让它们重算（`recomputeConsistency.test.ts` 抓到过旧截面残留）。
 */

function primitiveDependencies(primitive: PrimitiveSpec, relations?: { owners: Map<string, string>; topologies: Map<string, string> }): string[] {
  const dependencies: string[] = []
  /**
   * 模板物化出来的点 / 棱 / 面 / 多面体是**由实体算出来的**：实体一动它们就跟着重算。
   * 少了这条边，绑定在"实体的某个面 / 棱"上的点就不会随实体移动（实测缺陷）。
   */
  const owner = relations?.owners.get(primitive.id)
  if (owner && owner !== primitive.id) dependencies.push(owner)
  if (primitive.type === "point" && primitive.binding) {
    if (primitive.binding.kind === "onPath") dependencies.push(primitive.binding.pathId, ...(primitive.binding.parameterId ? [primitive.binding.parameterId] : []))
    if (primitive.binding.kind === "derived") dependencies.push(primitive.binding.sourceId)
  }
  if (primitive.type === "point3" && primitive.binding) {
    if (primitive.binding.kind === "onLine") dependencies.push(primitive.binding.lineId)
    if (primitive.binding.kind === "onPlane") dependencies.push(primitive.binding.planeId)
    if (primitive.binding.kind === "derived") dependencies.push(...primitive.binding.sourceIds)
    // 宿主绑定：宿主先算，绑定点后算（拓扑序因此自动正确）。
    if (primitive.binding.kind === "onHost") dependencies.push(primitive.binding.hostId, ...(primitive.binding.parameterId ? [primitive.binding.parameterId] : []))
    // 驱动参数是坐标的真值来源（与 2D 的 `onPath.parameterId` 同一条边）：少了它，改参数点不动。
    if (primitive.binding.kind === "onFace") dependencies.push(primitive.binding.faceId, ...(primitive.binding.parameterIds ?? []))
    if (primitive.binding.kind === "onSurface") dependencies.push(primitive.binding.solidId, ...(primitive.binding.parameterIds ?? []))
    // 实体内：点跟着实体的拓扑走（实体一动，点的坐标就按参数重算）。
    if (primitive.binding.kind === "inSolid") dependencies.push(primitive.binding.solidId, ...(primitive.binding.parameterIds ?? []))
  }
  if (primitive.type === "line") dependencies.push(...(primitive.slopeParameter ? [primitive.slopeParameter] : []))
  if (primitive.type === "line3") dependencies.push(...(primitive.definition.kind === "throughPoints" ? primitive.definition.pointIds : [primitive.definition.pointId]))
  if (primitive.type === "segment3") dependencies.push(...primitive.pointIds)
  if (primitive.type === "ray3") dependencies.push(primitive.originId, primitive.throughId)
  if (primitive.type === "plane3") dependencies.push(...(primitive.definition.kind === "throughPoints" ? primitive.definition.pointIds : [primitive.definition.pointId]))
  // 绕定点旋转的封闭曲线依赖那个定点（定点是点图元时）。定点一动，整条曲线跟着重算。
  if (isPlaceableConic(primitive)) {
    const pivotId = curveRotationPivotId(primitive)
    if (pivotId) dependencies.push(pivotId)
  }
  if (primitive.type === "edge3") dependencies.push(...primitive.pointIds, ...(primitive.faceIds ?? []))
  if (primitive.type === "face3") dependencies.push(...primitive.pointIds, ...(primitive.edgeIds ?? []), ...(primitive.planeId ? [primitive.planeId] : []))
  if (primitive.type === "polyhedron3") dependencies.push(...primitive.vertexIds, ...primitive.edgeIds, ...primitive.faceIds, ...(isSourceIdConstruction(primitive.construction) ? primitive.construction.sourceIds : []), ...(primitive.construction?.kind === "template" ? (primitive.construction.parameterIds ?? []) : []))
  // 连接（connection）只存两个点的引用，因此它依赖那些点；不含坐标，永远不会过期。
  if (primitive.type === "connection") dependencies.push(primitive.startPointId, primitive.endPointId, ...(primitive.control?.thirdPointId ? [primitive.control.thirdPointId] : []))
  if (primitive.type === "intersection") dependencies.push(primitive.lineA, primitive.lineB)
  if (primitive.type === "lineCircleIntersection") dependencies.push(primitive.lineId, primitive.circleId)
  if (primitive.type === "circleIntersection") dependencies.push(primitive.circleA, primitive.circleB)
  if (primitive.type === "curveIntersection") dependencies.push(primitive.objectA, primitive.objectB)
  if (primitive.type === "intersectionSet") dependencies.push(primitive.objectA, primitive.objectB)
  if (primitive.type === "intersectionLine") dependencies.push(...primitive.sourceIds)
  if (primitive.type === "intersectionSolid") dependencies.push(...primitive.sourceIds)
  if (primitive.type === "intersectionFace") dependencies.push(...primitive.sourceIds)
  if (primitive.type === "intersectionPoint3") dependencies.push(...primitive.sourceIds)
  if (primitive.type === "derivative" || primitive.type === "tangent" || primitive.type === "normal" || primitive.type === "secant" || primitive.type === "integral" || primitive.type === "analysisSet" || primitive.type === "section") dependencies.push(primitive.sourceId)
  /**
   * 曲线切线如果由**一个动点**定位，就依赖那个点：动点一动，切线跟着重算。
   * 少了这条边，切点会停在旧位置 —— 而"切线随动点动态变化"正是用户要的那个性质。
   */
  if ((primitive.type === "tangent" || primitive.type === "normal") && primitive.anchor?.kind === "point") dependencies.push(primitive.anchor.pointId)
  /**
   * "以动点为圆心"与"半径随动点走"的圆依赖那两个点。
   * 这两条边是整条动态链路的关键：圆心点 / 驱动点一动，`center` 与 `radius` 的派生缓存就过期，
   * 依赖图必须把它们重新算出来，否则圆会停在一个已经过时的位置和大小上。
   */
  if (primitive.type === "circle") {
    if (primitive.centerPointId) dependencies.push(primitive.centerPointId)
    // 三角形规则：三个顶点一起决定圆心与半径（少了任何一条边，改顶点时圆不会重算）。
    if (primitive.radiusFrom) {
      if (primitive.radiusFrom.kind === "triangle") dependencies.push(...primitive.radiusFrom.triangleIds)
      else dependencies.push(primitive.radiusFrom.pointId)
    }
  }
  /**
   * 依赖一个**实体**时，同时依赖它的物化拓扑。
   *
   * 实体的几何（顶点、面环）全在拓扑里，而截面 / 交线 / 交面 / 交点的来源写的是实体本身；
   * 只声明"依赖实体"的话，**按数值改一个顶点**（改的正是拓扑里的 point3）到不了它们，
   * 增量扫描会留下一份旧截面 / 旧交面（`recomputeConsistency.test.ts` 实测抓到）。
   */
  if (relations) {
    for (const dependency of [...dependencies]) {
      const topologyId = relations.topologies.get(dependency)
      if (topologyId && topologyId !== primitive.id) dependencies.push(topologyId)
    }
  }
  return [...new Set(dependencies)]
}

/**
 * 模板实体的两类关系：
 * - `owners`：物化出来的子对象（多面体自身、以及它的点 / 棱 / 面）→ 它属于哪个实体；
 * - `topologies`：实体 → 它的物化拓扑（那个多面体）。
 *
 * **为什么两样都要**：依赖图原先只有"多面体依赖它的点 / 棱 / 面 + 模板源"这一个方向，
 * 于是"实体 → 子对象"这条边根本不存在——从实体出发的闭包只到多面体就断了。
 * 后果是实测到的真缺陷：把点绑在立方体的某个面上再移动立方体，**绑定点留在原地**
 *（`getAffectedPrimitiveIds(["cube-a"])` 只有 `cube-a` 与多面体，到不了那个面，更到不了点）。
 *
 * 反过来，`topologies` 补的是另一条实测缺陷：截面 / 交面 / 交线的来源写的是**实体本身**，
 * 而实体的几何全在物化拓扑里。只声明依赖实体的话，**按数值改一个顶点**（改的是拓扑里的 point3）
 * 无法让它们重算——增量扫描后面会留下一份旧截面（`recomputeConsistency.test.ts` 抓到过）。
 */
function templateRelations(document: GeometryDocument): { owners: Map<string, string>; topologies: Map<string, string> } {
  const owners = new Map<string, string>()
  const topologies = new Map<string, string>()
  for (const primitive of document.primitives) {
    if (primitive.type !== "polyhedron3" || !primitive.construction) continue
    const construction = primitive.construction
    // 参数化模板记在 `sourceIds[0]`；按数值编辑过顶点的翻成 `fromFaces`，归属记在 `sourceId`。
    const owner = construction.kind === "template" ? construction.sourceIds[0] : construction.kind === "fromFaces" ? construction.sourceId : undefined
    if (!owner) continue
    owners.set(primitive.id, owner)
    topologies.set(owner, primitive.id)
    for (const childId of [...primitive.vertexIds, ...primitive.edgeIds, ...primitive.faceIds]) owners.set(childId, owner)
  }
  return { owners, topologies }
}

export function getDependencyIndex(document: GeometryDocument): Map<string, Set<string>> {
  const dependents = new Map<string, Set<string>>()
  const relations = templateRelations(document)
  for (const primitive of document.primitives) {
    for (const dependency of primitiveDependencies(primitive, relations)) {
      const primitiveDependents = dependents.get(dependency) ?? new Set<string>()
      primitiveDependents.add(primitive.id)
      dependents.set(dependency, primitiveDependents)
    }
  }
  for (const constraint of document.constraints) {
    if (constraint.targets.length !== 2) continue
    const [first, second] = constraint.targets
    const firstDependents = dependents.get(first) ?? new Set<string>()
    firstDependents.add(second)
    dependents.set(first, firstDependents)
    const secondDependents = dependents.get(second) ?? new Set<string>()
    secondDependents.add(first)
    dependents.set(second, secondDependents)
  }
  return dependents
}

export function getAffectedPrimitiveIds(document: GeometryDocument, changedIds: string[]): Set<string> {
  const dependents = getDependencyIndex(document)
  const affected = new Set(changedIds)
  const queue = [...changedIds]
  while (queue.length) {
    const changedId = queue.shift()!
    for (const dependent of dependents.get(changedId) ?? new Set<string>()) {
      if (affected.has(dependent)) continue
      affected.add(dependent)
      queue.push(dependent)
    }
  }
  return affected
}

/**
 * 受影响对象的**拓扑重算顺序**：任一对象的依赖都排在它前面。
 *
 * 主重算流程原来是"取所有受影响对象，按数组顺序各重算一次"，只在对象恰好按依赖顺序创建时正确。
 * 用拓扑序之后：一趟就能算完（`recomputeBoundPoint3s` 那个"最多重跑 N 遍直到不动"的循环因此可以去掉），
 * 并且能保证下游读到的是**刚算出来的**上游值。
 *
 * 两个安全措施：
 * - 依赖里只有真实存在的图元才建边（`slopeParameter` / `parameterId` 这类参数 id 不是图元，
 *   它们的值在参数求值的前置步骤里已经应用过，不需要参与排序）；
 * - 环里的节点不会出现在拓扑序中，直接过滤会**静默漏算**，所以按文档顺序补在末尾。
 */
export function topologicalRecomputeOrder(document: GeometryDocument, changedIds?: string[]): string[] {
  const graph = createDependencyGraph()
  const primitiveIds = new Set(document.primitives.map((primitive) => primitive.id))
  const relations = templateRelations(document)
  for (const primitive of document.primitives) {
    graph.addNode(primitive.id, primitiveDependencies(primitive, relations).filter((dependency) => primitiveIds.has(dependency)))
  }
  const affected = changedIds === undefined ? primitiveIds : getAffectedPrimitiveIds(document, changedIds)
  const ordered = graph.topologicalOrder().filter((id) => affected.has(id))
  const seen = new Set(ordered)
  for (const primitive of document.primitives) {
    if (!affected.has(primitive.id) || seen.has(primitive.id)) continue
    ordered.push(primitive.id)
    seen.add(primitive.id)
  }
  return ordered
}
