import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import type { DomainOperation } from "./operations"
import { movedSectionPlane, rotatedSectionPlane } from "./solidGeometry"
import { deletionPlan, layerDescendantIds, unbindDeletedHost, type DeletionPlan } from "./deletion"
import { EDITABLE_GEOMETRY_TYPES, isFreeDraggable3, isRotatable3, point3Index, prismMatchesVertices, primitiveBounds, realignPrismDescriptor, rotatePrimitive3, shiftedPoint, templateTopologyIds, translateFunction, translatePrimitive, translatePrimitive3 } from "./transforms"
import { dragBoundPoint } from "./resolve3d"

/**
 * **文档层唯一的写入口**（从 `operations.ts` 拆出，评审方案 2）：`applyOperation` 按 `op` 分派到各族，
 * 外加它自己用的四个小 helper（内容比对、变更判定、有限数校验、删除计划落地）。
 *
 * 它自己**不做几何**：每个分支要么改一个字段，要么把这件事交给已经切出去的族
 *（`transforms` 的平移 / 旋转、`resolve3d` 的绑定解析、`recompute` 的重算、`deletion` 的级联删除）。
 *
 * 三条口径随代码搬走：
 * 1. **"没变"的判据是内容**（`normalizeForComparison` / `documentChanged`）：一次空操作不该写成一步撤销；
 * 2. **一次 `applyOperation` = 一步撤销**：批量删除走整批提交，不是循环调用单条；
 * 3. **非有限数当场拒绝**（`requireFinite`）：NaN / Infinity 会污染几何内核，事后无法追溯。
 */

/**
 * 语义规范化：把"写法不同、含义相同"的差异抹平。
 *
 * 实测发现的真实差异（诊断脚本打印）：`addPrimitive` 时没写 `visible`，事后 `toggleVisibility`
 * 设 `true`，于是文档里 `visible: undefined → true` —— 两者**都表示可见**，却让 no-op 被判成改动。
 * 同一件事在 `locked` 上也会发生。
 *
 * `revision` 与 `updatedAt` 在这里被排除：它们是**版本与时间**，不是内容。
 */
function normalizeForComparison(value: unknown, key?: string): unknown {
  if (key === "revision" || key === "updatedAt") return undefined
  if (Array.isArray(value)) return value.map((item) => normalizeForComparison(item))
  if (value === null || typeof value !== "object") return value
  const out: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    if (childKey === "revision" || childKey === "updatedAt") continue
    // `visible: true` 与缺省**等价**（两者都表示"可见"），只有显式 `false` 才表示被关掉。
    // **`locked` 不能这样处理**：它的缺省是"未锁定"，`locked: true` 是一个真实的语义变化 ——
    // 把两者混为一谈会让 `toggleLock` 被判成 no-op，锁根本写不进文档（这是本任务实测踩到的坑）。
    if (childKey === "visible" && (childValue === undefined || childValue === true)) continue
    out[childKey] = normalizeForComparison(childValue, childKey)
  }
  return out
}

function documentChanged(before: GeometryDocument, after: GeometryDocument): boolean {
  return JSON.stringify(normalizeForComparison(before)) !== JSON.stringify(normalizeForComparison(after))
}

/**
 * 运行时操作守卫由 `operationNames.ts` 定义（那里有真值列表，且不会与它形成循环导入），
 * 这里再导出一份，让 `./operations` 作为操作相关 API 的统一入口保持完整。
 */
/**
 * 数值参数必须是有限数（Task 0.3 的补强）。
 *
 * 为什么必须有这道闸：`moveSectionPlane` 收到 `NaN` 时会把 `plane.constant` 写成 `NaN`，
 * 既不提前返回也不抛错 —— 于是"被拒绝的操作"看起来像一次成功提交。
 * 更糟的是 `NaN` 在 JSON 里序列化成 `null`，任何基于序列化的比较都会把它读成"内容变了"。
 * 所以**在入口拒绝**，而不是事后靠比较去猜。
 */
function requireFinite(values: Readonly<Record<string, number | undefined>>, operationName: string): string | null {
  for (const [field, value] of Object.entries(values)) {
    if (value !== undefined && !Number.isFinite(value)) return `${operationName}: ${field} must be a finite number`
  }
  return null
}


/**
 * 把一次删除**计划**应用到文档上（`deleteObject` 与 `deleteObjects` 共用，避免两套语义漂移）。
 *
 * 顺序是刻意的：先解绑（宿主没了的点降级为自由点、保留位置），再过滤图元，
 * **最后**回收孤儿驱动参数 —— 若在过滤前回收，被删图元自己的绑定会被算成"仍被引用"。
 */
function applyDeletionPlan(next: GeometryDocument, ids: string[]): { plan: DeletionPlan; removedAny: boolean } {
  const plan = deletionPlan(next, ids)
  const targets = plan.primitives
  const before = next.primitives.length
  next.primitives = next.primitives.map((primitive) => unbindDeletedHost(primitive, targets)).filter((primitive) => !targets.has(primitive.id))
  const removedAny = before !== next.primitives.length

  if (plan.measurements.size > 0) next.measurements = next.measurements.filter((measurement) => !plan.measurements.has(measurement.id))
  if (plan.annotations.size > 0) next.annotations = next.annotations.filter((annotation) => !plan.annotations.has(annotation.id))
  if (plan.engineeringAnnotations.size > 0 && next.engineeringAnnotations) next.engineeringAnnotations = next.engineeringAnnotations.filter((annotation) => !plan.engineeringAnnotations.has(annotation.id))
  if (plan.constraints.size > 0) next.constraints = next.constraints.filter((constraint) => !plan.constraints.has(constraint.id))
  if (plan.groupMembers.size > 0) next.groups = next.groups
    .map((group) => group.members.some((member) => plan.groupMembers.has(member)) ? { ...group, members: group.members.filter((member) => !plan.groupMembers.has(member)) } : group)
    // 只剩一个成员（或空）的分组是无效数据：`validateDocument` 要求成员 ≥ 2，
    // 留着它会让整份文档再也存不下去（`encodeMgeo` 抛 "group has invalid members"）。直接解散。
    .filter((group) => group.members.length >= 2)

  /**
   * 回收"随对象自动生成"的驱动参数。判据是**孤儿**而不是"本次被删"：
   * 只要它带 `ownerId`（自动生成）且**没有任何图元引用它**，就是垃圾 —— 不论归属对象是否还在。
   *
   * 为什么不再要求"归属对象也没了"：宿主（曲线 / 面 / 实体）被删除时，绑定点会被**降级为自由点**
   * （见 `unbindDeletedHost`，位置保留），于是那个 `t-<点id>` 参数既没有引用者、也不再有意义，
   * 却因为归属点还在而留在文档里（实测：删掉圆之后参数列表里多出一个没人用的 "A 的路径参数"）。
   * 这里只在**删除操作**里跑，不存在"刚解绑、马上又要重绑"的中间态。
   * 用户手工创建的参数不带 `ownerId`，永远不会被这一步碰掉。
   */
  for (const [parameterId, parameter] of Object.entries(next.parameters)) {
    if (!parameter.ownerId) continue
    if (parameterIsReferenced(next, parameterId)) continue
    delete next.parameters[parameterId]
  }
  return { plan, removedAny }
}

export interface OperationResult {
  document: GeometryDocument
  changed: boolean
  error?: string
}

/**
 * 参数是否仍被某个图元引用。两个用途：回收自动生成的驱动参数时确认它真的成了孤儿，
 * 以及拒绝删除仍被绑定的参数。调用前应先完成图元的增删，这样判断的是**当前**状态。
 *
 * 3D 宿主绑定的驱动参数（`point3.binding.parameterId` / `onFace|onSurface|inSolid.parameterIds`）
 * 必须一起算进来：`schema` 把它们做成了硬校验（悬空即非法），`encodeMgeo` 对非法文档直接抛，
 * 所以漏掉它们意味着"一次普通删除就能造出一份存不下去的文档"，而回收那一步还会把仍在使用的
 * 驱动参数当垃圾删掉。
 */
// 重算主族在 `./recompute`（评审方案 2 拆出来的）。
import { recomputeDerivedObjects } from "./recompute"
export { recomputeDerivedObjects } from "./recompute"

export function parameterIsReferenced(document: GeometryDocument, parameterId: string): boolean {
  return document.primitives.some((primitive) => {
    if (primitive.type === "line" && primitive.slopeParameter === parameterId) return true
    if (primitive.type === "point" && primitive.binding?.kind === "onPath" && primitive.binding.parameterId === parameterId) return true
    if (primitive.type === "locus" && primitive.parameterId === parameterId) return true
    if (primitive.type === "polyhedron3" && primitive.construction?.kind === "template") return (primitive.construction.parameterIds ?? []).includes(parameterId)
    if (primitive.type === "point3" && primitive.binding) {
      const binding = primitive.binding
      if (binding.kind === "onHost" && binding.parameterId === parameterId) return true
      // 三个 uv/uvw 变体的元组长度不同，先收成 `readonly string[]` 再查，免得 `includes` 落在元组并集上。
      const driverIds: readonly string[] | undefined = binding.kind === "onFace" || binding.kind === "onSurface" || binding.kind === "inSolid" ? binding.parameterIds : undefined
      if (driverIds?.includes(parameterId)) return true
    }
    return false
  })
}

export function applyOperation(document: GeometryDocument, operation: DomainOperation): OperationResult {  const next = structuredClone(document) as GeometryDocument
  let changedIds: string[] = []
  if (operation.op === "addPrimitive") {
    if (next.primitives.some((primitive) => primitive.id === operation.primitive.id)) return { document, changed: false, error: "duplicate object id" }
    next.primitives.push(operation.primitive)
    changedIds = [operation.primitive.id]
  } else if (operation.op === "addPrimitives") {
    if (operation.primitives.some((primitive, index) => next.primitives.some((candidate) => candidate.id === primitive.id) || operation.primitives.slice(0, index).some((candidate) => candidate.id === primitive.id))) return { document, changed: false, error: "duplicate object id" }
    next.primitives.push(...operation.primitives)
    changedIds = operation.primitives.map((primitive) => primitive.id)
  } else if (operation.op === "updatePrimitive") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)

    const geometryPatchKeys = Object.keys(operation.patch).filter((key) => key !== "style" && key !== "label")
    if (!primitive || (geometryPatchKeys.length > 0 && !(EDITABLE_GEOMETRY_TYPES as readonly string[]).includes(primitive.type)) || primitive.locked) return { document, changed: false, error: primitive?.locked ? "object is locked" : "object is not editable" }
    if (primitive.type === "point") {
      if (operation.patch.x !== undefined) primitive.x = operation.patch.x
      if (operation.patch.y !== undefined) primitive.y = operation.patch.y
      if (operation.patch.binding !== undefined) primitive.binding = operation.patch.binding
    }
    if (primitive.type === "point3") {
      if (operation.patch.position3 !== undefined) primitive.position = { ...operation.patch.position3 }
      if (operation.patch.binding3 !== undefined) primitive.binding = operation.patch.binding3
      if (operation.patch.position3 !== undefined) {
        for (const candidate of next.primitives) {
          if (candidate.type !== "polyhedron3" || !candidate.vertexIds.includes(primitive.id)) continue
          if (candidate.construction?.kind === "template") {
            /**
             * 模板一旦有顶点被按数值改动，就不再是"参数化模板"了，改记成显式面环构造。
             * **归属要一起带走**（`sourceId`）：否则这个实体在截面 / 交线 / 交面里就找不到自己的拓扑，
             * 会被静默跳过（实测缺陷）。
             */
            candidate.construction = { kind: "fromFaces", sourceIds: [...candidate.faceIds], sourceId: candidate.construction.sourceIds[0] }
            continue
          }
          /**
           * **棱柱**（Fix round 2 / I4）：`construction` 是声明的真源（规格 §1.2），
           * 所以顶点一动就必须重新判断"这份描述还算不算数"：
           *
           * - 还能对上（每个顶点与 `底面 + 向量` 的约定一致，例如拖走整只实体）→ **保留** `prism`；
           * - 对不上（拖了某一个顶点、底座被拉得不共面……）→ 与模板同款处理，
           *   改记成显式面环 `fromFaces` 并保留归属 `sourceId`。描述与几何从此一致，
           *   也不会留下一句"我是按底面与向量拉伸出来的"这种与环境矛盾的假话。
           */
          if (candidate.construction?.kind === "prism" && !prismMatchesVertices(candidate, candidate.construction, next.primitives)) {
            candidate.construction = { kind: "fromFaces", sourceIds: [...candidate.faceIds], sourceId: candidate.id }
          }
        }
      }
    }
    if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") {
      if (operation.patch.a) primitive.a = { ...primitive.a, ...operation.patch.a }
      if (operation.patch.b) primitive.b = { ...primitive.b, ...operation.patch.b }
    }
    if (primitive.type === "polyline" && operation.patch.points) primitive.points = operation.patch.points
    if (primitive.type === "parabola") {
      if (operation.patch.vertex) primitive.vertex = { ...primitive.vertex, ...operation.patch.vertex }
      if (operation.patch.focalParameter !== undefined) primitive.focalParameter = operation.patch.focalParameter
      if (operation.patch.axis !== undefined) primitive.axis = operation.patch.axis
      if (operation.patch.rotation !== undefined) primitive.rotation = operation.patch.rotation
    }
    if (primitive.type === "ellipse" || primitive.type === "hyperbola") {
      if (operation.patch.center) primitive.center = { ...primitive.center, ...operation.patch.center }
      if (operation.patch.radiusX !== undefined) primitive.radiusX = operation.patch.radiusX
      if (operation.patch.radiusY !== undefined) primitive.radiusY = operation.patch.radiusY
      if (primitive.type === "hyperbola" && operation.patch.axis !== undefined) primitive.axis = operation.patch.axis
      if (operation.patch.rotation !== undefined) primitive.rotation = operation.patch.rotation
      if (primitive.type === "ellipse" && operation.patch.rotationAbout !== undefined) primitive.rotationAbout = operation.patch.rotationAbout
    }
    if (primitive.type === "function") {
      if (operation.patch.expression !== undefined) primitive.expression = operation.patch.expression
      if (operation.patch.domain !== undefined) primitive.domain = operation.patch.domain
      if (operation.patch.samples !== undefined) primitive.samples = operation.patch.samples
    }
    if (primitive.type === "circle" || primitive.type === "arc") {
      if (operation.patch.center) primitive.center = { ...primitive.center, ...operation.patch.center }
      if (operation.patch.radius !== undefined) primitive.radius = operation.patch.radius
      // 圆现在也有朝向（`rotation`）与"绕定点旋转"（`rotationAbout`）：见 DSL 的 `CurveRotation`。
      // 写成"整块替换"而不是只改 angle —— 定点与转角必须一起落，中间态会让曲线短暂地不再过定点。
      if (primitive.type === "circle" && operation.patch.rotation !== undefined) primitive.rotation = operation.patch.rotation
      if (primitive.type === "circle" && operation.patch.rotationAbout !== undefined) primitive.rotationAbout = operation.patch.rotationAbout
      /**
       * 圆心点 / 半径驱动规则。`null` 是"去掉这条规则"：删字段而不是写 null，
       * 因为 schema 与导出都把缺省当成"没有这条规则"，留一个 `null` 会让校验与往返都多出一个特例。
       * 圆心被点接管后 `rotationAbout` 就没有意义了（两者会争夺同一个 `center`），一并清掉。
       */
      if (primitive.type === "circle" && operation.patch.centerPointId !== undefined) {
        if (operation.patch.centerPointId === null) delete primitive.centerPointId
        else {
          primitive.centerPointId = operation.patch.centerPointId
          delete primitive.rotationAbout
        }
      }
      if (primitive.type === "circle" && operation.patch.radiusFrom !== undefined) {
        if (operation.patch.radiusFrom === null) delete primitive.radiusFrom
        else primitive.radiusFrom = operation.patch.radiusFrom
      }
    }
    /**
     * 切线 / 法线：曲线来源的定位方式与绘制半长。
     *
     * 这是"在曲线上作切线"之后唯一需要用户调的两件事：切点沿曲线滑到哪里（`anchor`）、
     * 以及画多长（`halfLength`）。函数来源的旧切线不带 `anchor`，因此完全不受影响。
     */
    if (primitive.type === "tangent" || primitive.type === "normal") {
      if (operation.patch.anchor !== undefined) {
        if (operation.patch.anchor === null) delete primitive.anchor
        else primitive.anchor = operation.patch.anchor
      }
      if (operation.patch.halfLength !== undefined) primitive.halfLength = operation.patch.halfLength
      /**
       * 函数来源的旧切线用横坐标定位：沿函数图像拖动切线就是改这个 `x`。
       * **带 `anchor` 的曲线切线不在这里**——它的切点由 `anchor` 决定，写 `x` 只会被下一趟重算覆盖掉，
       * 那种切线的拖动走 `anchor.parameter`（见 `interaction.ts` 的 `createDragAction`）。
       */
      if (!primitive.anchor && operation.patch.x !== undefined) primitive.x = operation.patch.x
    }
    if (primitive.type === "arc") {
      if (operation.patch.startAngle !== undefined) primitive.startAngle = operation.patch.startAngle
      if (operation.patch.endAngle !== undefined) primitive.endAngle = operation.patch.endAngle
    }
    if (primitive.type === "plane3" && operation.patch.halfSize !== undefined) {
      // null puts the plane back on automatic sizing; JSON.stringify then drops the field entirely.
      if (operation.patch.halfSize === null || !(operation.patch.halfSize > 0)) delete primitive.halfSize
      else primitive.halfSize = operation.patch.halfSize
    }
    if (primitive.type === "cube") {
      if (operation.patch.origin3) primitive.origin = { ...primitive.origin, ...operation.patch.origin3 }
      if (operation.patch.size3) primitive.size = { ...primitive.size, ...operation.patch.size3 }
      if (operation.patch.rotation3) primitive.rotation = { ...(primitive.rotation ?? { x: 0, y: 0, z: 0 }), ...operation.patch.rotation3 }
    }
    if (primitive.type === "pyramid") {
      if (operation.patch.baseCenter3) primitive.baseCenter = { ...primitive.baseCenter, ...operation.patch.baseCenter3 }
      if (operation.patch.baseSize3) primitive.baseSize = { ...primitive.baseSize, ...operation.patch.baseSize3 }
      if (operation.patch.height !== undefined) primitive.height = operation.patch.height
      if (operation.patch.rotation3) primitive.rotation = { ...(primitive.rotation ?? { x: 0, y: 0, z: 0 }), ...operation.patch.rotation3 }
    }
    if (primitive.type === "cylinder" || primitive.type === "cone") {
      if (operation.patch.center3) primitive.center = { ...primitive.center, ...operation.patch.center3 }
      if (operation.patch.radius3 !== undefined) primitive.radius = operation.patch.radius3
      if (operation.patch.height !== undefined) primitive.height = operation.patch.height
      if (operation.patch.segments !== undefined) primitive.segments = operation.patch.segments
      if (operation.patch.rotation3) primitive.rotation = { ...(primitive.rotation ?? { x: 0, y: 0, z: 0 }), ...operation.patch.rotation3 }
    }
    // 空间圆轨道：圆心、半径都是它自己的参数（法向由旋转操作改）。
    if (primitive.type === "circle3") {
      if (operation.patch.center3) primitive.center = { ...primitive.center, ...operation.patch.center3 }
      if (operation.patch.radius3 !== undefined) primitive.radius = operation.patch.radius3
    }
    if (operation.patch.label !== undefined) primitive.label = operation.patch.label
    // A template solid paints its generated point/edge/face children, so a template style change recolours them too.
    if (operation.patch.style !== undefined && ["cube", "pyramid", "cylinder", "cone"].includes(primitive.type)) {
      for (const candidate of next.primitives) {
        if (candidate.type !== "polyhedron3" || candidate.construction?.kind !== "template" || candidate.construction.sourceIds[0] !== primitive.id) continue
        candidate.style = { ...candidate.style, ...operation.patch.style }
        for (const childId of [...candidate.vertexIds, ...candidate.edgeIds, ...candidate.faceIds]) {
          const child = next.primitives.find((entry) => entry.id === childId)
          if (child) child.style = { ...child.style, ...operation.patch.style }
        }
      }
    }
    if (operation.patch.style !== undefined) primitive.style = { ...primitive.style, ...operation.patch.style }
    changedIds = [operation.id]
  } else if (operation.op === "translatePrimitive") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (primitive) {
      const primitiveMap = new Map(next.primitives.map((candidate) => [candidate.id, candidate]))
      const dragged = primitive.type === "point"
        ? dragBoundPoint(primitive, operation.delta, primitiveMap, next.parameters)
        : null
      if (dragged) {
        // 约束点沿曲线滑动：写回自己的参数（以及它绑定的文档参数），坐标由重算统一求出。
        next.primitives = next.primitives.map((candidate) => candidate.id === operation.id ? dragged.point : candidate)
        if (dragged.parameterValue) {
          const parameter = next.parameters[dragged.parameterValue.id]
          if (parameter) next.parameters[dragged.parameterValue.id] = { ...parameter, value: dragged.parameterValue.value }
          changedIds = [operation.id, dragged.parameterValue.id]
        } else {
          changedIds = [operation.id]
        }
      } else {
        next.primitives = next.primitives.map((candidate) => candidate.id !== operation.id
          ? candidate
          : candidate.type === "function" ? translateFunction(candidate, operation.delta.x, operation.delta.y) : translatePrimitive(candidate, operation.delta.x, operation.delta.y))
        changedIds = [operation.id]
      }
    }
  } else if (operation.op === "translatePrimitive3") {
    const deltaError = requireFinite({ x: operation.delta.x, y: operation.delta.y, z: operation.delta.z }, "translatePrimitive3: delta")
    if (deltaError) return { document, changed: false, error: deltaError }
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    if (!isFreeDraggable3(primitive, point3Index(next), templateTopologyIds(next))) return { document, changed: false, error: "object is not draggable" }
    const moved = translatePrimitive3(primitive, operation.delta)
    const movedIds = new Set(moved.movedIds)
    next.primitives = next.primitives
      .map((candidate) => candidate.id === operation.id ? moved.primitive : candidate)
      // A point-driven object is moved by moving its points; the object itself only follows through recompute.
      .map((candidate) => candidate.type === "point3" && candidate.id !== operation.id && movedIds.has(candidate.id) ? { ...candidate, position: shiftedPoint(candidate.position, operation.delta) } : candidate)
    // Sections name their source by id, so they are not in the dependency index: a moved solid has to
    // re-derive its own cuts explicitly, or the drawn section would keep the old shape while the solid moves.
    const cutIds = next.primitives.filter((candidate): candidate is Extract<PrimitiveSpec, { type: "section" }> => candidate.type === "section" && candidate.sourceId === operation.id).map((section) => section.id)
    changedIds = [...movedIds, operation.id, ...cutIds]
    // 搬完整只实体之后重检它的构造描述（外部审查 M1）：棱柱的顶点已经动了，
    // 描述符不能继续宣称旧的底面与向量。
    const movedSolid = next.primitives.find((candidate) => candidate.id === operation.id)
    if (movedSolid) realignPrismDescriptor(movedSolid, next.primitives)
  } else if (operation.op === "rotatePrimitive3") {
    const angleError = requireFinite({ degrees: operation.degrees }, "rotatePrimitive3")
    if (angleError) return { document, changed: false, error: angleError }
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    const points = point3Index(next)
    if (!isRotatable3(primitive, points, templateTopologyIds(next))) return { document, changed: false, error: "object is not rotatable" }
    const turned = rotatePrimitive3(primitive, points, operation.axis, operation.degrees, operation.pivot)
    if (!turned) return { document, changed: false, error: "object has no geometry to rotate" }
    const turnedPoints = new Map(turned.movedPoints.map((moved) => [moved.id, moved.position]))
    next.primitives = next.primitives.map((candidate) => {
      if (candidate.id === operation.id) return turned.primitive
      // 点驱动的对象由它的点带着转；模板实体的物化拓扑由 `buildSolidTemplate` 重算。
      if (candidate.type === "point3" && turnedPoints.has(candidate.id)) return { ...candidate, position: turnedPoints.get(candidate.id)! }
      return candidate
    })
    // 截面按 id 记来源、不在依赖索引里：实体转了，它的截面必须同一次提交里重算，否则刀口与形状对不上。
    const cutIds = next.primitives.filter((candidate): candidate is Extract<PrimitiveSpec, { type: "section" }> => candidate.type === "section" && candidate.sourceId === operation.id).map((section) => section.id)
    changedIds = [operation.id, ...turnedPoints.keys(), ...cutIds]
    // 同上：转完整只实体之后重检构造描述（外部审查 M1）。
    const turnedSolid = next.primitives.find((candidate) => candidate.id === operation.id)
    if (turnedSolid) realignPrismDescriptor(turnedSolid, next.primitives)
  } else if (operation.op === "moveSectionPlane") {
    const distanceError = requireFinite({ distance: operation.distance }, "moveSectionPlane")
    if (distanceError) return { document, changed: false, error: distanceError }
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive || primitive.type !== "section") return { document, changed: false, error: "section not found" }
    primitive.plane = movedSectionPlane(primitive.plane, operation.distance)
    // 剖切面变了，截面点必须在同一次提交里重算，否则画布上的形状和读数会对不上。
    changedIds = [operation.id]
  } else if (operation.op === "rotateSectionPlane") {
    const angleError = requireFinite({ degrees: operation.degrees }, "rotateSectionPlane")
    if (angleError) return { document, changed: false, error: angleError }
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive || primitive.type !== "section") return { document, changed: false, error: "section not found" }
    primitive.plane = rotatedSectionPlane(primitive.plane, operation.axis, operation.degrees, operation.pivot)
    changedIds = [operation.id]
  } else if (operation.op === "setSectionPlane") {
    const planeError = requireFinite({ nx: operation.normal.x, ny: operation.normal.y, nz: operation.normal.z, constant: operation.constant }, "setSectionPlane")
    if (planeError) return { document, changed: false, error: planeError }
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive || primitive.type !== "section") return { document, changed: false, error: "section not found" }
    primitive.plane = { normal: { ...operation.normal }, constant: operation.constant }
    changedIds = [operation.id]
  } else if (operation.op === "toggleLock") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    primitive.locked = operation.locked
  } else if (operation.op === "setParameter") {
    const parameter = next.parameters[operation.id] ?? { id: operation.id, value: operation.value }
    // 只在显式给出时覆盖元数据，这样拖动滑块（只带 value）不会抹掉参数已有的 min/max/label。
    next.parameters[operation.id] = {
      ...parameter,
      value: operation.value,
      expression: undefined,
      ...(operation.min === undefined ? {} : { min: operation.min }),
      ...(operation.max === undefined ? {} : { max: operation.max }),
      ...(operation.step === undefined ? {} : { step: operation.step }),
      ...(operation.label === undefined ? {} : { label: operation.label }),
      ...(operation.ownerId === undefined ? {} : { ownerId: operation.ownerId })
    }
    changedIds = [operation.id]
  } else if (operation.op === "deleteParameter") {
    if (!next.parameters[operation.id]) return { document, changed: false, error: "parameter not found" }
    // 参数还被图元引用时不能删：绑定里的 parameterId 一旦悬空，点会静默冻住。
    if (parameterIsReferenced(next, operation.id)) return { document, changed: false, error: "parameter is referenced by an object" }
    delete next.parameters[operation.id]
  } else if (operation.op === "setParameterExpression") {
    const parameter = next.parameters[operation.id] ?? { id: operation.id, value: 0 }
    next.parameters[operation.id] = { ...parameter, expression: operation.expression }
    changedIds = [operation.id]
  } else if (operation.op === "addAnnotation") {
    next.annotations.push(operation.annotation)
  } else if (operation.op === "deleteAnnotation") {
    const before = next.annotations.length
    next.annotations = next.annotations.filter((annotation) => annotation.id !== operation.id)
    if (before === next.annotations.length) return { document, changed: false, error: "annotation not found" }
  } else if (operation.op === "addEngineeringAnnotation") {
    if (next.engineeringAnnotations?.some((annotation) => annotation.id === operation.annotation.id)) return { document, changed: false, error: "duplicate engineering annotation id" }
    next.engineeringAnnotations = [...(next.engineeringAnnotations ?? []), operation.annotation]
    changedIds = operation.annotation.sourceIds
  } else if (operation.op === "deleteEngineeringAnnotation") {
    const annotations = next.engineeringAnnotations ?? []
    const filtered = annotations.filter((annotation) => annotation.id !== operation.id)
    if (filtered.length === annotations.length) return { document, changed: false, error: "engineering annotation not found" }
    next.engineeringAnnotations = filtered
  } else if (operation.op === "addConstraint") {
    if (next.constraints.some((constraint) => constraint.id === operation.constraint.id)) return { document, changed: false, error: "duplicate constraint id" }
    next.constraints.push(operation.constraint)
    changedIds = operation.constraint.targets
  } else if (operation.op === "deleteObject") {
    const { plan, removedAny } = applyDeletionPlan(next, [operation.id])
    if (!removedAny) return { document, changed: false, error: "object not found" }
    changedIds = [...plan.primitives]
  } else if (operation.op === "deleteObjects") {
    // 一次算清整批的并集闭包，所以与 ids 的顺序无关（Task 0.4）。
    const { plan, removedAny } = applyDeletionPlan(next, operation.ids)
    if (!removedAny) return { document, changed: false, error: "object not found" }
    changedIds = [...plan.primitives]
  } else if (operation.op === "deleteConstraint") {
    const before = next.constraints.length
    next.constraints = next.constraints.filter((constraint) => constraint.id !== operation.id)
    if (before === next.constraints.length) return { document, changed: false, error: "constraint not found" }
  } else if (operation.op === "addMeasurement") {
    if (next.measurements.some((measurement) => measurement.id === operation.measurement.id)) return { document, changed: false, error: "duplicate measurement id" }
    next.measurements.push(operation.measurement)
    changedIds = operation.measurement.sourceIds
  } else if (operation.op === "deleteMeasurement") {
    const before = next.measurements.length
    next.measurements = next.measurements.filter((measurement) => measurement.id !== operation.id)
    if (before === next.measurements.length) return { document, changed: false, error: "measurement not found" }
  } else if (operation.op === "toggleVisibility") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    primitive.visible = operation.visible
  } else if (operation.op === "createGroup") {
    next.groups.push(operation.group)
  } else if (operation.op === "deleteGroup") {
    next.groups = next.groups.filter((group) => group.id !== operation.id)
  } else if (operation.op === "setPrimitivesLocked") {
    for (const primitive of next.primitives) if (operation.ids.includes(primitive.id)) primitive.locked = operation.locked
  } else if (operation.op === "setPrimitivesVisible") {
    for (const primitive of next.primitives) if (operation.ids.includes(primitive.id)) primitive.visible = operation.visible
  } else if (operation.op === "setPrimitivesStyle") {
    /**
     * 批量改外观（颜色 / 线宽 / 透明度 / 线型）。
     *
     * 为什么需要它：逐条 `updatePrimitive` 只能一条条提交，"选中五个对象一起改成红色"会变成五次撤销步骤，
     * 而且多选时检查器里改颜色以前只作用于**主选中**那一个（用户以为全改了，其实没有）。
     * 这里一次提交改完所有选中对象，撤销也只要一步。
     * `undefined` 表示"清除这一项、回到默认"，所以是显式赋值而不是合并。
     */
    for (const primitive of next.primitives) {
      if (!operation.ids.includes(primitive.id) || primitive.locked) continue
      // 注意：走到这里的"锁住成员"只可能来自**绕过 `validatePatch` 的直接调用**（测试 / 内部重算）。
      // 经补丁路径的批量改样式已经在 `patches.ts` 里被**整体拒绝**（与批量显隐同一条策略，
      // 外部审查 M3）—— 那条路径下不会有成员被静默跳过。
      const style = { ...primitive.style }
      // 逐项显式处理（不用 `as` 绕类型）：`undefined` 是**有意义的赋值**——清除这一项、回到默认。
      if ("stroke" in operation.style) { if (operation.style.stroke === undefined) delete style.stroke; else style.stroke = operation.style.stroke }
      if ("fill" in operation.style) { if (operation.style.fill === undefined) delete style.fill; else style.fill = operation.style.fill }
      if ("dash" in operation.style) { if (operation.style.dash === undefined) delete style.dash; else style.dash = operation.style.dash }
      if ("strokeWidth" in operation.style) { if (operation.style.strokeWidth === undefined) delete style.strokeWidth; else style.strokeWidth = operation.style.strokeWidth }
      if ("opacity" in operation.style) { if (operation.style.opacity === undefined) delete style.opacity; else style.opacity = operation.style.opacity }
      primitive.style = Object.keys(style).length > 0 ? style : undefined
    }
  } else if (operation.op === "alignPrimitives") {
    const selected = next.primitives.filter((primitive) => operation.ids.includes(primitive.id))
    const bounds = selected.map((primitive) => primitiveBounds(primitive)!)
    const target = operation.alignment === "left" ? Math.min(...bounds.map((value) => value.minX))
      : operation.alignment === "right" ? Math.max(...bounds.map((value) => value.maxX))
        : operation.alignment === "top" ? Math.max(...bounds.map((value) => value.maxY))
          : operation.alignment === "bottom" ? Math.min(...bounds.map((value) => value.minY))
            : operation.alignment === "horizontalCenter" ? bounds.reduce((sum, value) => sum + (value.minX + value.maxX) / 2, 0) / bounds.length
              : bounds.reduce((sum, value) => sum + (value.minY + value.maxY) / 2, 0) / bounds.length
    next.primitives = next.primitives.map((primitive) => {
      if (!operation.ids.includes(primitive.id)) return primitive
      const value = primitiveBounds(primitive)!
      const x = operation.alignment === "left" ? target - value.minX
        : operation.alignment === "right" ? target - value.maxX
          : operation.alignment === "horizontalCenter" ? target - (value.minX + value.maxX) / 2 : 0
      const y = operation.alignment === "top" ? target - value.maxY
        : operation.alignment === "bottom" ? target - value.minY
          : operation.alignment === "verticalCenter" ? target - (value.minY + value.maxY) / 2 : 0
      return translatePrimitive(primitive, x, y)
    })
    changedIds = operation.ids
  } else if (operation.op === "addLayer") {
    next.layers = [...(next.layers ?? []), operation.layer]
    if (!next.activeLayerId) next.activeLayerId = operation.layer.id
  } else if (operation.op === "updateLayer") {
    next.layers = (next.layers ?? []).map((layer) => layer.id === operation.id ? { ...layer, ...operation.patch, id: layer.id } : layer)
  } else if (operation.op === "deleteLayer") {
    const removedIds = layerDescendantIds(next, operation.id)
    const targetId = operation.reassignTo ?? (next.layers ?? []).find((layer) => layer.kind === "geometry" && !removedIds.has(layer.id))?.id
    if (!targetId) return { document, changed: false, error: "no replacement layer" }
    next.primitives = next.primitives.map((primitive) => removedIds.has(primitive.layerId ?? "") ? { ...primitive, layerId: targetId } : primitive)
    next.layers = (next.layers ?? []).filter((layer) => !removedIds.has(layer.id))
    if (removedIds.has(next.activeLayerId ?? "")) next.activeLayerId = targetId
  } else if (operation.op === "setActiveLayer") {
    next.activeLayerId = operation.id
  } else if (operation.op === "addDrawingSheet") {
    next.drawingSheets = [...(next.drawingSheets ?? []), operation.sheet]
    if (!next.activeSheetId) next.activeSheetId = operation.sheet.id
  } else if (operation.op === "updateDrawingSheet") {
    next.drawingSheets = (next.drawingSheets ?? []).map((sheet) => sheet.id === operation.id ? { ...sheet, ...operation.patch, id: sheet.id } : sheet)
  } else if (operation.op === "addDrawingView") {
    next.drawingViews = [...(next.drawingViews ?? []), operation.view]
  } else if (operation.op === "updateDrawingView") {
    next.drawingViews = (next.drawingViews ?? []).map((view) => view.id === operation.id ? { ...view, ...operation.patch, id: view.id } : view)
  } else if (operation.op === "deleteDrawingView") {
    next.drawingViews = (next.drawingViews ?? []).filter((view) => view.id !== operation.id)
    next.drawingSheets = (next.drawingSheets ?? []).map((sheet) => ({ ...sheet, viewIds: sheet.viewIds.filter((viewId) => viewId !== operation.id) }))
  }
  try {
    const recomputed = recomputeDerivedObjects(next, changedIds)
    /**
     * 只有**真的变了**才推进 revision（Task 0.3）。
     * 以前这里无条件 `revision += 1` 并返回 `changed: true`，于是"把已经可见的对象再设为可见"
     * 这类空操作也会在撤销栈里留下一步 —— Agent 端更糟：它会据此认为"确实改动了文档"，
     * 从而跳过"无变化"的分支。判定放在重算**之后**，所以派生几何的变化也算改动。
     */
    const mutated = documentChanged(document, recomputed)
    if (!mutated) return { document, changed: false }
    recomputed.revision += 1
    recomputed.metadata.updatedAt = new Date().toISOString()
    return { document: recomputed, changed: true }
  } catch (error) {
    return { document, changed: false, error: error instanceof Error ? error.message : "Failed to recompute document" }
  }
}
