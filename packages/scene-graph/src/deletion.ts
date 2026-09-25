import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { functionAnalysisSourceId, isPlaceableConic, isSourceIdConstruction } from "./primitiveKinds"

/**
 * **删除的级联判据**（从 `operations.ts` 拆出，评审方案 2）。
 *
 * 这一族回答一个问题：**删掉一个对象，会带走谁**。
 *
 * 判据是**派生性**，不是"有没有人引用"：交点、轨迹、连接完全由来源决定，自己不含独立几何 ——
 * 所以来源没了它们就没有独立存在的意义，应当被级联带走，而不是以 "object is referenced by
 * another object" 拒绝删除。反过来，一个被别的对象引用的普通图元被删时，引用方要**改指向或解绑**
 *（见 `unbindDeletedHost`），这才是"删除不留下悬空引用"的那一半。
 *
 * 搬动**逐行原样**：在 `operations.ts` 里它就是一段连续代码（起点 `/**` 在 2031、终点 `}` 在 2251，
 * 2026-09-25 第 62 轮逐行核对过）。
 */

/**
 * 一个图元"纯派生"地依赖哪些对象 —— 也就是"这些来源没了，它就没有独立存在的意义"。
 *
 * 这些对象在删除时会被级联带走，而不是以"object is referenced by another object"拒绝删除。
 * 判据是**派生性**：交点、轨迹、连接都完全由来源决定，自己不含任何独立几何。
 */
function cascadeSources(primitive: PrimitiveSpec): string[] {
  if (primitive.type === "intersection") return [primitive.lineA, primitive.lineB]
  if (primitive.type === "lineCircleIntersection") return [primitive.lineId, primitive.circleId]
  if (primitive.type === "circleIntersection") return [primitive.circleA, primitive.circleB]
  if (primitive.type === "curveIntersection") return [primitive.objectA, primitive.objectB]
  if (primitive.type === "intersectionSet") return [primitive.objectA, primitive.objectB]
  if (primitive.type === "locus") return [primitive.sourcePointId]
  if (primitive.type === "connection") return [primitive.startPointId, primitive.endPointId, ...(primitive.control?.thirdPointId ? [primitive.control.thirdPointId] : [])]
  // 截面与截线同样是**纯派生**对象：删掉来源实体时用户不该先手动清掉它们。
  if (primitive.type === "section") return [primitive.sourceId]
  if (primitive.type === "intersectionLine") return primitive.sourceIds
  if (primitive.type === "intersectionSolid") return primitive.sourceIds
  if (primitive.type === "intersectionFace") return primitive.sourceIds
  if (primitive.type === "intersectionPoint3") return primitive.sourceIds
  /**
   * 以某个点为**定点**的曲线（"动圆"）：定点在，它才谈得上"过这个定点"。
   *
   * 用户口径："在删除定点后，这个动圆也会跟着消失"。所以这是级联、不是"被引用所以拒绝删除"：
   * 定点一走，曲线的存在意义就没了（它的圆心正是由定点 + 半径算出来的）。
   */
  if (isPlaceableConic(primitive) && primitive.rotationAbout?.pivot.kind === "primitive") return [primitive.rotationAbout.pivot.primitiveId]
  /**
   * "以动点为圆心的圆"：圆心点一走，圆就没有圆心了 —— 与"动圆"同一个判据（派生随宿主注销）。
   * 但**半径驱动点**不同：它只是"半径读多少"的来源，圆心还在、圆还有意义，
   * 所以它走 `unbindDeletedHost` 那条路（丢掉规则、保留最后的半径），而不是级联删除。
   */
  if (primitive.type === "circle" && primitive.centerPointId) return [primitive.centerPointId]
  /**
   * 切线的定位点：用户口径是"动点在哪就在哪作切线"。
   * 动点没了，切线就不知道该切在哪 —— 它是纯派生的，随点一起注销，而不是留一条悬空的旧切线。
   */
  if ((primitive.type === "tangent" || primitive.type === "normal") && primitive.anchor?.kind === "point") return [primitive.anchor.pointId]
  const analysisSource = functionAnalysisSourceId(primitive)
  return analysisSource === null ? [] : [analysisSource]
}

/**
 * 一次删除要连带处理的东西。
 *
 * 语义（用户已确认）：**派生与标注随宿主一起注销**，用户自己搭出来的构造引用仍然拒绝删除
 * （除非一起选中——那条路由 `validateDeletion` 做并集校验）。
 * 绑定点不删：宿主没了就把它**降级为自由点**并保留位置，不静默吞掉用户的内容。
 */
export interface DeletionPlan {
  primitives: Set<string>
  measurements: Set<string>
  annotations: Set<string>
  engineeringAnnotations: Set<string>
  constraints: Set<string>
  groupMembers: Set<string>
}

export function deletionPlan(document: GeometryDocument, ids: string[]): DeletionPlan {
  const primitives = new Set(ids.flatMap((id) => [...deletionTargets(document, id)]))
  return {
    primitives,
    measurements: new Set(document.measurements.filter((measurement) => measurement.sourceIds.some((sourceId) => primitives.has(sourceId))).map((measurement) => measurement.id)),
    annotations: new Set(document.annotations.filter((annotation) => (typeof annotation.target === "string" && primitives.has(annotation.target)) || (annotation.anchor?.kind === "primitive" && primitives.has(annotation.anchor.primitiveId))).map((annotation) => annotation.id)),
    engineeringAnnotations: new Set((document.engineeringAnnotations ?? []).filter((annotation) => annotation.sourceIds.some((sourceId) => primitives.has(sourceId))).map((annotation) => annotation.id)),
    constraints: new Set(document.constraints.filter((constraint) => constraint.targets.some((target) => primitives.has(target))).map((constraint) => constraint.id)),
    // 分组是用户的容器：只把被删成员摘掉，空分组保留（不替用户丢东西）。
    groupMembers: new Set(document.groups.flatMap((group) => group.members).filter((member) => primitives.has(member)))
  }
}

/** 宿主被删除时把引用它的点降级为自由点（位置保留），避免悬空引用让文档存不下去。 */
export function unbindDeletedHost(primitive: PrimitiveSpec, deleted: Set<string>): PrimitiveSpec {
  if (primitive.type === "point3" && primitive.binding && primitive.binding.kind !== "free") {
    const binding = primitive.binding
    const hostId = binding.kind === "onLine" ? binding.lineId : binding.kind === "onPlane" ? binding.planeId : binding.kind === "onHost" ? binding.hostId : binding.kind === "onFace" ? binding.faceId : binding.kind === "onSurface" || binding.kind === "inSolid" ? binding.solidId : null
    const sources = binding.kind === "derived" ? binding.sourceIds : hostId ? [hostId] : []
    if (sources.some((sourceId) => deleted.has(sourceId))) return { ...primitive, binding: { kind: "free" } }
  }
  if (primitive.type === "point" && primitive.binding?.kind === "onPath" && deleted.has(primitive.binding.pathId)) return { ...primitive, binding: { kind: "free" } }
  /**
   * 半径的驱动点被删掉时，圆**不消失**：圆心还在、半径也还有最后一次的值，圆的含义仍然完整。
   * 丢掉那条规则（半径从此变回可以直接编辑的数字），比静默留下一个悬空引用好得多
   * —— 悬空引用在重算里找不到来源，半径会冻在最后一个值上，用户改都改不动。
   */
  if (primitive.type === "circle" && primitive.radiusFrom) {
    // 三角形规则：任一顶点被删就整条规则作废（与"驱动点被删"同一处理：圆留下、规则丢掉）。
    const sources = primitive.radiusFrom.kind === "triangle" ? primitive.radiusFrom.triangleIds : [primitive.radiusFrom.pointId]
    if (sources.some((sourceId) => deleted.has(sourceId))) return { ...primitive, radiusFrom: undefined }
  }
  // 平面点的 `derived` 绑定与空间点同理：来源没了就降级为自由点，绝不留悬空引用
  //（悬空引用在重算里找不到来源，点会静默冻住；这与 schema 里点名过的坑是同一类）。
  if (primitive.type === "point" && primitive.binding?.kind === "derived" && deleted.has(primitive.binding.sourceId)) return { ...primitive, binding: { kind: "free" } }
  return primitive
}

/**
 * A template solid (cube/pyramid/cylinder/cone) is not a single primitive: the workspace also materialises a
 * polyhedron plus its vertices, edges and faces so the figure can be drawn and measured. Those parts exist only
 * to draw the solid, so for deletion they are the same object — deleting any member deletes the family. Treating
 * the generated parts as ordinary referrers instead made a solid impossible to delete, and deleting the
 * generated part alone left the rest of the figure floating in the scene.
 *
 * Function analysis objects are the same story: a 导函数/切线/积分区域/分析集 only exists to describe its source
 * function. Counting them as ordinary referrers made a legacy calculus document's function impossible to delete
 * ("object is referenced by another object"), so they are deleted together with the function they came from.
 *
 * **交点同理**：删除一条直线时，用户不应该先手动删掉它与别的图形的交点再回来删直线。
 * 交点、轨迹、连接都是纯派生对象，一律随来源级联删除。
 */
/**
 * 一条拓扑碎片（`point3` / `edge3` / `face3`）**直接引用**的其它图元。
 *
 * 只收拓扑之间那几种引用（点 / 棱 / 面），**不收 `planeId`**：平面是**构造**，不是拓扑的一部分 ——
 * 把平面卷进来会顺手删掉用户自己搭的东西，"构造引用仍然拒绝删除"那条语义就被悄悄放宽了。
 */
function topologyReferences(primitive: PrimitiveSpec): string[] {
  if (primitive.type === "edge3") return [...primitive.pointIds, ...(primitive.faceIds ?? [])]
  if (primitive.type === "face3") return [...primitive.pointIds, ...(primitive.edgeIds ?? [])]
  return []
}

/**
 * **没有实体当锚时，把互相引用的拓扑收成一片**（2026-09-23，用户现场第二形态）。
 *
 * 用户那份文档里**没有 `polyhedron3`**：模型当年用约 10 个动作把 4 个顶点 / 6 条棱 / 4 个面
 * 各自拼出来（运行账本 `run-1-mue30vw6` 记着 `staging 10 action(s)`），于是族判定找不到"族"，
 * 点任意一片都被别的片引用 ⇒ `object is referenced by another object` ⇒ **整片都删不掉**。
 *
 * 判据取**连通分量**：从点中的那一片出发，反复把"引用了组内对象"与"被组内对象引用"的拓扑并进来。
 * 只认拓扑之间的引用，所以一个孤立的空间点、以及线 / 面 / 平面这些**构造**都不会被卷进来。
 */
function expandTopologyCluster(document: GeometryDocument, targets: Set<string>): void {
  const isTopology = (primitive: PrimitiveSpec) => primitive.type === "point3" || primitive.type === "edge3" || primitive.type === "face3"
  let added = true
  while (added) {
    added = false
    for (const primitive of document.primitives) {
      if (targets.has(primitive.id) || !isTopology(primitive)) continue
      const referencesTarget = topologyReferences(primitive).some((reference) => targets.has(reference))
      const referencedByTarget = document.primitives.some((other) => targets.has(other.id) && topologyReferences(other).includes(primitive.id))
      if (referencesTarget || referencedByTarget) {
        targets.add(primitive.id)
        added = true
      }
    }
  }
}

export function deletionTargets(document: GeometryDocument, id: string): Set<string> {
  const targets = new Set<string>([id])
  // 模板实体的拓扑是一整族，先按成员归属整体纳入，后面的级联才看得到它们。
  const polyhedron = document.primitives.find((primitive) => {
    if (primitive.type !== "polyhedron3") return false
    /**
     * **模板实体与棱柱都是"一只实体 + 它自己物化出来的拓扑"**（外部审查 S2）。
     *
     * 原先这里只认 `kind === "template"`，于是删除棱柱时**只删掉 `polyhedron3` 本身**：
     * 它的顶点 / 棱 / 面（26 个）全部留在文档里并**继续绘制** —— 而模板立方体删除时
     * 连同 28 个成员一起走、0 残留。两者成员的来路完全一样（都由实体自己物化），
     * 删除语义必须一致；否则用户看到的是"删了实体，一地碎片还在画布上"。
     *
     * 注意这与 `templateTopologyIds`（拖动）**不是**同一条规则：棱柱生成的顶点是
     * **可编辑**的（`prismMatchesVertices` 正是为"顶点被改过、描述要改写"准备的），
     * 所以它们不该被排除在自由拖动之外。删除是另一回事：整族一起走。
     */
    /**
     * **不再按 `construction.kind` 筛**（2026-09-23，用户现场："agent 创建的元素无法删除"）。
     *
     * 原先这里只认 `template` 与 `prism` 两种，于是 Agent 建的**正四面体**掉进了缝里 ——
     * 它是**第三种构造** `fromPoints`（`solid.create_tetrahedron` → 内核 `buildFromPoints` 物化）：
     * ① 删实体本身只删掉 `polyhedron3`，4 个顶点 / 6 条棱 / 4 个面留在画布上继续绘制；
     * ② 删其中任意一个成员（用户点的往往是画布上那个顶点）被判成
     *    `object is referenced by another object` 而**拒绝** —— 用户看到的就是"删不掉"。
     *
     * 四种构造（`template` / `prism` / `fromPoints` / `fromFaces`）的成员来路完全一样（都由实体自己物化），
     * 删除语义必须一致：**一只实体 + 它自己物化出来的拓扑就是同一个对象**。
     */
    if (primitive.id === id || primitive.vertexIds.includes(id) || primitive.edgeIds.includes(id) || primitive.faceIds.includes(id)) return true
    // `template` / `fromPoints` / `fromFaces` 才有 `sourceIds`；`prism` **没有**这一支
    //（它的来源是自带的底面多边形与拉伸向量），所以必须先收窄再读。
    return isSourceIdConstruction(primitive.construction) && primitive.construction.sourceIds[0] === id
  })
  if (polyhedron && polyhedron.type === "polyhedron3") {
    for (const member of [polyhedron.id, ...(isSourceIdConstruction(polyhedron.construction) ? polyhedron.construction.sourceIds : []), ...polyhedron.vertexIds, ...polyhedron.edgeIds, ...polyhedron.faceIds]) targets.add(member)
  } else {
    // 没有实体当锚（模型把立体拆成散片拼出来的那种文档，2026-09-23 用户现场）：按拓扑连通分量成组。
    expandTopologyCluster(document, targets)
  }
  /**
   * 固定点迭代，不能只扫一趟：级联出来的对象本身可能还被别的派生对象引用。
   * 例如"直线 → 连接（引用该直线上的点）→ 连接与圆的交点"，一趟只能收到中间那层。
   */
  let added = true
  while (added) {
    added = false
    for (const primitive of document.primitives) {
      if (targets.has(primitive.id)) continue
      const sources = cascadeSources(primitive)
      if (sources.length === 0 || !sources.some((sourceId) => targets.has(sourceId))) continue
      targets.add(primitive.id)
      added = true
    }
  }
  return targets
}

export function layerDescendantIds(document: GeometryDocument, id: string): Set<string> {
  const descendants = new Set<string>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const layer of document.layers ?? []) {
      if (layer.parentId && descendants.has(layer.parentId) && !descendants.has(layer.id)) {
        descendants.add(layer.id)
        changed = true
      }
    }
  }
  return descendants
}
