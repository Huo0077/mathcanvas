/**
 * 自由拖动：屏幕平面位移、拖动族与偏移应用
 *
 * 从 threeScene.tsx 抽出来的纯函数：它们与 React 无关，独立成模块后可以直接单测，
 * 组件文件也不再混着一堆非组件导出（react-refresh 的告警就是这么来的）。
 */
import * as THREE from "three"
import type { GeometryDocument } from "@draw/dsl"
import { getDependencyIndex } from "@draw/scene-graph"

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
