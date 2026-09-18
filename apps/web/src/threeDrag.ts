/**
 * 自由拖动：屏幕平面位移、拖动族与偏移应用
 *
 * 从 threeScene.tsx 抽出来的纯函数：它们与 React 无关，独立成模块后可以直接单测，
 * 组件文件也不再混着一堆非组件导出（react-refresh 的告警就是这么来的）。
 */
import * as THREE from "three"
import type { GeometryDocument } from "@draw/dsl"
import { getDependencyIndex, isRotatable3, managedPointIds, templateTopologyIds } from "@draw/scene-graph"
import { templateSolidPivot } from "@draw/geometry-kernel"

/**
 * 自由拖动：被拖对象在屏幕平面上的落点。
 * 与相机自身基向量求交，所以相机转过之后图形仍然跟着指针走；深度保持不变，拖动不会把人拽进纵深。
 */
export function dragWorldPoint(camera: THREE.Camera, anchor: THREE.Vector3, normalizedPoint: { x: number; y: number }): THREE.Vector3 | null {
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(normalizedPoint.x * 2 - 1, -(normalizedPoint.y * 2 - 1)), camera)
  const normal = new THREE.Vector3()
  camera.getWorldDirection(normal)
  // A plane seen edge-on cannot be intersected: the drag would slide to infinity, so keep the figure put.
  return Math.abs(normal.dot(raycaster.ray.direction)) < 1e-6 ? null : raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor), new THREE.Vector3())
}

/**
 * 自由拖动一个对象时真正要跟着动的全部对象：它自己、它按 id 引用的点（线段/棱/面/平面/多面体），
 * 以及模板实体所生成的点/棱/面。少了这一步，拖点驱动的棱就"只动属性不动画面"。
 */
export function dragFamilyIds(document: GeometryDocument, id: string): Set<string> {
  const { dependents, parents } = dragGraph(document)
  const family = new Set<string>([id])
  const queue = [id]
  while (queue.length > 0) {
    for (const childId of dependents.get(queue.shift()!) ?? []) {
      if (family.has(childId)) continue
      family.add(childId)
      queue.push(childId)
    }
  }
  // 生成的拓扑是"由父级算出来"的：拖动父级要连它的点/棱/面一起动，否则实体看着没动。
  for (const member of [...family]) for (const parentId of parents.get(member) ?? []) family.add(parentId)
  return family
}

/** 依赖索引的正反两向：正向着找"谁跟着它动"，反向着找"它是由谁生成的"。 */
function dragGraph(document: GeometryDocument): { dependents: Map<string, Set<string>>; parents: Map<string, Set<string>> } {
  const dependents = new Map<string, Set<string>>()
  const parents = new Map<string, Set<string>>()
  for (const [parentId, childIds] of getDependencyIndex(document)) {
    for (const childId of childIds) {
      const entries = dependents.get(parentId) ?? new Set<string>()
      entries.add(childId)
      dependents.set(parentId, entries)
      const owners = parents.get(childId) ?? new Set<string>()
      owners.add(parentId)
      parents.set(childId, owners)
    }
  }
  return { dependents, parents }
}

/**
 * 这个对象是不是"同一个图元的最外层可见对象"。
 *
 * 一个图元在场景里可能是**组 + 子对象**两层都挂着同一个 `primitiveId`（边界圆就是这样：
 * `createRimCircles3` 给组挂一次、`createConic3Line` 给每圈线又挂一次）。偏移只该画在最外层那一层上：
 * 两层都加，等于同一个位移算了两次，那棵子树会以**两倍**速度跑掉——用户实测反馈"自由移动圆锥圆柱时，
 * 底部圆的动画单独跑掉了，不跟手一起"就是这么来的（实体的网格 / 棱只有一层，所以只有圆飞出去）。
 *
 * 组平移会把整个子树一起带走，所以"跳过有同 id 祖先的对象"在几何上与逐层各加一次等价。
 */
function isOutermostForPrimitive(object: THREE.Object3D): boolean {
  const id = object.userData.primitiveId
  for (let parent = object.parent; parent; parent = parent.parent) {
    if (parent.userData.primitiveId === id) return false
  }
  return true
}

/**
 * 把一个位移画到某个对象自己的可视元素上（不重建场景）。
 * 拖动剖切面时用它：截面本体与剖切面片都属于同一个图元，一起挪才有"刀口在动"的观感。
 */
export function offsetSceneObjects(scene: THREE.Scene, primitiveId: string, delta: THREE.Vector3): void {
  scene.traverse((object) => {
    if (object.userData.primitiveId !== primitiveId || !isOutermostForPrimitive(object)) return
    object.position.add(delta)
    recordDragOffset(object, delta)
  })
}

/**
 * 把一个拖动位移画到场景里，而不重建场景。拖动期间文档只在节流点提交，逐帧重建会明显卡顿；
 * 这里先把 offset 记在对象上，渲染前统一应用，抬手后再由文档接替。
 * `delta` 传零即撤销这些临时偏移，用于把画面交还给文档。
 */
export function applyDragOffsets(scene: THREE.Scene, family: Set<string>, delta: THREE.Vector3): void {
  scene.traverse((object) => {
    const objectId = object.userData.primitiveId
    if (typeof objectId !== "string" || !family.has(objectId) || !isOutermostForPrimitive(object)) return
    object.position.add(delta)
    recordDragOffset(object, delta)
  })
}

/** 记下这个对象被临时画上了多少偏移（`dragOffsetDrift` 用它核对"画面 == 位移"）。 */
function recordDragOffset(object: THREE.Object3D, delta: THREE.Vector3): void {
  const applied = (object.userData.dragOffset as THREE.Vector3 | undefined) ?? new THREE.Vector3()
  applied.add(delta)
  object.userData.dragOffset = applied
}

/* ------------------------------------------------------------------ *
 * 拖动旋转：三色环 + 绕世界轴的角度 + 15° 吸附 + 临时旋转
 *
 * 用户口径："我希望能给立体图形增加旋转功能，就像我想要一个横着的圆柱，可以在图中拖着圆柱旋转。"
 * 语义与属性栏的 `rotatePrimitive3` **完全同一套**：绕世界轴、右手法则、枢轴取对象自己的中心，
 * 所以"拖出来的角度"与"文档里写的欧拉角"说的是同一件事（读数 `data-rotation-degrees` 与属性栏能对上）。
 * ------------------------------------------------------------------ */

/** 旋转手柄的三个世界轴（与属性栏「朝向」那三个字段同名，避免两套叫法）。 */
export const ROTATION_AXES = ["x", "y", "z"] as const

/** 拖动旋转的吸附步长（度）：15° 正好覆盖课堂上的 30 / 45 / 60 / 90，按住 Alt 则不吸附。 */
export const ROTATION_SNAP_DEGREES = 15

/** 世界轴单位向量。 */
export function rotationAxisVector(axis: "x" | "y" | "z"): THREE.Vector3 {
  return axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
}

/**
 * 垂直于该轴的平面里用的参考基：`u` 取右手循环里的下一个轴（X→Y→Z→X），`v = axis × u`。
 *
 * 于是"把 u 转到 v"恰好是该轴右手法则的 +90°（绕 X：ŷ → ẑ）。参考基的**手性**决定了拖动的符号，
 * 取反了就会"往上拖、读数往下转"——这一条是拖动手感与数值一致的关键，不是随便挑的两个向量。
 */
export function rotationPlaneBasis(axis: "x" | "y" | "z"): { u: THREE.Vector3; v: THREE.Vector3 } {
  const u = rotationAxisVector(axis === "x" ? "y" : axis === "y" ? "z" : "x")
  return { u, v: rotationAxisVector(axis).cross(u) }
}

/** 两个角度之间的**最短弧**增量（弧度）：跨过 ±π 时不会跳一整圈。 */
export function shortestAngleDelta(from: number, to: number): number {
  const raw = to - from
  return Math.atan2(Math.sin(raw), Math.cos(raw))
}

/**
 * 指针指向的"绕该轴转了多少"：把指针射线与**过枢轴、以该轴为法向**的平面求交，取交点在平面内的极角。
 *
 * 这与圆环所在的那个平面是同一个平面，所以"指针落在环上的哪一点"就是转角本身；
 * 射线与该平面平行（正对着环看）时返回 `null`——那时候指针位置没有意义，不该猜一个角度出来。
 */
export function rotationAngleAt(camera: THREE.Camera, pivot: THREE.Vector3, axis: "x" | "y" | "z", normalizedPoint: { x: number; y: number }): number | null {
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(normalizedPoint.x * 2 - 1, -(normalizedPoint.y * 2 - 1)), camera)
  const normal = rotationAxisVector(axis)
  const hit = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, pivot), new THREE.Vector3())
  if (!hit) return null
  const offset = hit.sub(pivot)
  const { u, v } = rotationPlaneBasis(axis)
  return Math.atan2(offset.dot(v), offset.dot(u))
}

/** 一次拖动旋转的会话状态：`raw` 是累计的原始角度，`applied` 是已经画进画面的（可能吸附过的）角度。 */
export interface RotationDragState {
  axis: "x" | "y" | "z"
  pivot: THREE.Vector3
  lastAngle: number
  raw: number
  applied: number
}

export function beginRotationDrag(axis: "x" | "y" | "z", pivot: THREE.Vector3, angle: number): RotationDragState {
  return { axis, pivot: pivot.clone(), lastAngle: angle, raw: 0, applied: 0 }
}

/**
 * 指针动了一步：累加最短弧增量，按当前**累计值**吸附（不是每步增量各自吸附，否则误差会一路累积），
 * 返回这一步该画进画面的角度增量（`step`，弧度）与当前累计角度（`radians`）。
 *
 * `snapRadians` 传 `null` 表示不吸附（按住 Alt）。
 */
export function advanceRotationDrag(state: RotationDragState, angle: number, snapRadians: number | null): { state: RotationDragState; step: number; radians: number } {
  const raw = state.raw + shortestAngleDelta(state.lastAngle, angle)
  const applied = snapRadians === null || snapRadians <= 0 ? raw : Math.round(raw / snapRadians) * snapRadians
  return { state: { ...state, lastAngle: angle, raw, applied }, step: applied - state.applied, radians: applied }
}

/** 这次拖动当前转过的角度（度）——提交给文档的就是它，画面与文档说的是同一个数。 */
export function rotationDragDegrees(state: RotationDragState): number {
  return (state.applied * 180) / Math.PI
}

/** 真的转过吗？没转过就不提交（一次误触不该多出一步撤销）。 */
export function hasRotationMovement(state: RotationDragState, tolerance = 1e-9): boolean {
  return Math.abs(state.applied) > tolerance
}

/**
 * 把一次临时旋转画到场景里（拖动期间文档不提交）。
 *
 * 位移那条路踩过一次坑：一个图元可能是"组 + 子对象"两层都挂着同一个 `primitiveId`，两层各画一次
 * 就等于转了**两倍**角度。这里与 `applyDragOffsets` 共用同一条"只落在最外层"的规则；
 * 组转了会带着子树一起转，子对象再转一次就是两倍角度。
 *
 * 传负角度即撤销这些临时旋转，把画面交还给文档。
 */
export function applyRotationSkew(scene: THREE.Scene, family: Set<string>, pivot: THREE.Vector3, axis: "x" | "y" | "z", radians: number): void {
  if (Math.abs(radians) < 1e-12) return
  const rotation = new THREE.Quaternion().setFromAxisAngle(rotationAxisVector(axis), radians)
  scene.traverse((object) => {
    const objectId = object.userData.primitiveId
    if (typeof objectId !== "string" || !family.has(objectId) || !isOutermostForPrimitive(object)) return
    object.position.sub(pivot).applyQuaternion(rotation).add(pivot)
    object.quaternion.premultiply(rotation)
  })
}

/**
 * 选中**恰好一个**可转对象时给出它的 id：多选时"绕谁转"没有唯一答案，所以不给手柄。
 * 可转的判据与域操作同源（`isRotatable3`），画布上能拖的与文档肯接受的永远一致。
 */
export function rotationHandleTarget(document: GeometryDocument, selectedIds: string[]): string | null {
  const ids = [...new Set(selectedIds)]
  if (ids.length !== 1) return null
  return rotationHandleGeometry(document, ids[0]) ? ids[0] : null
}

/** 一个可转对象的手柄位置与大小；不可以转（点 / 物化拓扑 / 锁定）时返回 `null`。 */
export function rotationHandleGeometry(document: GeometryDocument, id: string): { center: THREE.Vector3; radius: number } | null {
  const primitive = document.primitives.find((candidate) => candidate.id === id)
  if (!primitive) return null
  const points = new Map(document.primitives.filter((candidate): candidate is Extract<typeof candidate, { type: "point3" }> => candidate.type === "point3").map((point) => [point.id, point]))
  if (!isRotatable3(primitive, points, templateTopologyIds(document))) return null
  if (primitive.type === "cube" || primitive.type === "pyramid" || primitive.type === "cylinder" || primitive.type === "cone") {
    const center = templateSolidPivot(primitive)
    // 半径取"离中心最远的那个物化顶点"，也就是画面上真正画出来的那个范围。
    const vertices = templateVertices(document, primitive.id)
    const reach = vertices.reduce((worst, vertex) => Math.max(worst, Math.hypot(vertex.x - center.x, vertex.y - center.y, vertex.z - center.z)), fallbackReach(primitive))
    return { center: new THREE.Vector3(center.x, center.y, center.z), radius: handleRadius(reach) }
  }
  // 轨道圆自带圆心坐标与半径：环心就是它自己的圆心、reach 就是半径（不再走"取它拥有的点的形心"，
  // 那条路在轨道圆不再拥有点之后会返回 null ⇒ 三个旋转环会**静默消失**）。
  if (primitive.type === "circle3") return { center: new THREE.Vector3(primitive.center.x, primitive.center.y, primitive.center.z), radius: handleRadius(primitive.radius) }
  const owned = managedPointIds(primitive).map((pointId) => points.get(pointId)?.position).filter((position): position is { x: number; y: number; z: number } => Boolean(position))
  if (owned.length === 0) return null
  const center = owned.reduce((sum, position) => ({ x: sum.x + position.x / owned.length, y: sum.y + position.y / owned.length, z: sum.z + position.z / owned.length }), { x: 0, y: 0, z: 0 })
  const ownReach = owned.reduce((worst, position) => Math.max(worst, Math.hypot(position.x - center.x, position.y - center.y, position.z - center.z)), 0)
  // 点驱动对象（空间面 / 线 / 棱 / 多边形）：环要圈住离重心最远的那个顶点。
  return { center: new THREE.Vector3(center.x, center.y, center.z), radius: handleRadius(ownReach) }
}

/** 环要圈住对象才好抓，也不能离题太远。 */
function handleRadius(reach: number): number {
  return Math.max(reach * 1.25 + 0.3, 1.2)
}

/** 模板实体的物化顶点（画面上真正画出来的那些点）。 */
function templateVertices(document: GeometryDocument, solidId: string): { x: number; y: number; z: number }[] {
  const polyhedron = document.primitives.find((primitive) => primitive.type === "polyhedron3" && primitive.construction?.kind === "template" && primitive.construction.sourceIds[0] === solidId)
  if (!polyhedron || polyhedron.type !== "polyhedron3") return []
  const points = new Map(document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "point3" }> => primitive.type === "point3").map((point) => [point.id, point]))
  return polyhedron.vertexIds.map((vertexId) => points.get(vertexId)?.position).filter((position): position is { x: number; y: number; z: number } => Boolean(position))
}

/** 没有物化拓扑时的兜底范围（手工搭出来的文档）：按尺寸参数估一个。 */
function fallbackReach(primitive: { type: string; size?: { x: number; y: number; z: number }; baseSize?: { x: number; y: number }; radius?: number; height?: number }): number {
  if (primitive.type === "cube" && primitive.size) return Math.hypot(primitive.size.x, primitive.size.y, primitive.size.z) / 2
  if (primitive.type === "pyramid" && primitive.baseSize) return Math.max(Math.hypot(primitive.baseSize.x, primitive.baseSize.y) / 2, (primitive.height ?? 0) / 2)
  return Math.max(primitive.radius ?? 0, (primitive.height ?? 0) / 2, 1)
}

/**
 * 指针命中了哪个环？只有命中环才开旋转会话——否则在图形本体上按下也会转起来。
 *
 * 只对环做射线求交（不管挡在前面的实体）：手柄是**显式**的操作面，被实体挡住的那半圈也得能抓，
 * 这是所有三维软件的惯例，也是"环看得见却点不中"这种困惑的来源。
 */
export function rotationHandleAxisAt(handles: THREE.Object3D, camera: THREE.Camera, normalizedPoint: { x: number; y: number }): "x" | "y" | "z" | null {
  handles.updateMatrixWorld(true)
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(normalizedPoint.x * 2 - 1, -(normalizedPoint.y * 2 - 1)), camera)
  for (const hit of raycaster.intersectObjects(handles.children, false)) {
    const axis = hit.object.userData.rotationAxis
    if (axis === "x" || axis === "y" || axis === "z") return axis
  }
  return null
}

/**
 * 拖动偏移的**一致性读数**：`family` 里每个对象由"自己 + 祖先"累计到的临时偏移，应当恰好等于
 * 本次拖动画上去的那个位移。返回最大偏差（0 = 画面与位移完全一致）。
 *
 * 为什么要有这个读数：拖动期间**文档不提交**，画面全靠这些临时偏移，所以"偏移被重复画了一层"
 * 这类错误在文档里看不出来、只能看画布（用户实测反馈："自由移动圆锥圆柱时，底部圆的动画单独跑掉了，
 * 不跟手一起"——边界圆的组与子对象各被加了一次，圆以两倍速度飞出去）。这条不变量把它变成可断言的数字。
 */
export function dragOffsetDrift(scene: THREE.Scene, family: Set<string>, applied: THREE.Vector3): number {
  let worst = 0
  scene.traverse((object) => {
    const objectId = object.userData.primitiveId
    if (typeof objectId !== "string" || !family.has(objectId)) return
    const total = new THREE.Vector3()
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
      const offset = current.userData.dragOffset as THREE.Vector3 | undefined
      if (offset) total.add(offset)
    }
    worst = Math.max(worst, total.sub(applied).length())
  })
  return worst
}
