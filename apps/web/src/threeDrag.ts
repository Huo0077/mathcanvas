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
 * 把一个位移画到某个对象自己的可视元素上（不重建场景）。
 * 拖动剖切面时用它：截面本体与剖切面片都属于同一个图元，一起挪才有"刀口在动"的观感。
 */
export function offsetSceneObjects(scene: THREE.Scene, primitiveId: string, delta: THREE.Vector3): void {
  scene.traverse((object) => {
    if (object.userData.primitiveId !== primitiveId) return
    object.position.add(delta)
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
    if (typeof objectId !== "string" || !family.has(objectId)) return
    const applied = (object.userData.dragOffset as THREE.Vector3 | undefined) ?? new THREE.Vector3()
    object.position.add(delta)
    applied.add(delta)
    object.userData.dragOffset = applied
  })
}
