import type { RefObject } from "react"
import * as THREE from "three"

import type { ThreeScenePreview } from "./threeScenePreview"
import type { ThreeSceneViewProps } from "./threeScene"
import { applyPreviewHighlight } from "./threePrimitives"

/**
 * **3D 预览的悬停判定与高亮**（从 `threeSceneEffect.ts` 里按阶段切出来的第二块，评审方案 2）。
 *
 * 四件事：按指针位置求世界射线（`raycasterAt`）、在候选预览里挑出**更具体**的那一份
 *（`previewHitAt`）、就地改材质做高亮（`setPreviewHoverKey`）、以及把"悬停在哪一份"告诉状态栏
 *（`updatePreviewHover` / `pointerleave`）。
 *
 * ## 三条写在这里的口径
 *
 * 1. **同一处命中好几份预览时取更具体的**：点 > 线 > 面（`previewSpecificity`）。交线的拐点上同时
 *    压着交点标记、交线命中带与两边的交面片，用户指的是那个点；只有面片中间没有更具体的东西才归交面。
 * 2. **高亮是就地改材质**，不触发内容重建 —— 一次重建要重算整场几何，悬停每动一下都重建是不可接受的。
 * 3. **状态栏跟着指针换**：从一份预览滑到另一份时要重新说一遍"这是什么、点下去创建什么"，
 *    所以"换了哪一份"与"还悬停着没有"是两个不同的判据（`lastPreview` / `previewHovering`）。
 *
 * ## 依赖里的两个 Map 是"稳定身份"
 *
 * `previewGroups` / `previewByKey` 原来在每次内容同步时**重新赋值**成新的 Map；为了让它们能作为
 * 稳定依赖传给本模块，内容同步改成了 `.clear()`（同一只 Map 就地清空再填）。语义不变：
 * 两边读的都是"当前这一份"，只是引用不再换。
 */

export interface ThreeScenePreviewHoverDeps {
  camera: THREE.PerspectiveCamera
  /** 预览 key → 场景分组（内容同步就地维护，见文件头）。 */
  previewGroups: Map<string, THREE.Group>
  /** 预览 key → 预览本身（`previewGroups` 的同伴）。 */
  previewByKey: Map<string, ThreeScenePreview>
  previewHoverKeyRef: RefObject<string | null>
  previewHoverRef: RefObject<ThreeSceneViewProps["onPreviewHover"]>
  sceneShell: HTMLDivElement | null
  /** 指针事件 → 归一化坐标（与"棱在不在指针下"共用同一条换算）。 */
  pointFromEvent: (event: PointerEvent) => { x: number; y: number }
  /** 世界单位的点击容差：抓取宽度永远是同样多的像素。 */
  pickTolerance: () => number
}

export function createThreeScenePreviewHover({ camera, previewGroups, previewByKey, previewHoverKeyRef, previewHoverRef, sceneShell, pointFromEvent, pickTolerance }: ThreeScenePreviewHoverDeps) {
  const raycasterAt = (normalizedPoint: { x: number; y: number }) => {
    const raycaster = new THREE.Raycaster()
    raycaster.params.Line = { threshold: pickTolerance() }
    raycaster.setFromCamera(new THREE.Vector2(normalizedPoint.x * 2 - 1, -(normalizedPoint.y * 2 - 1)), camera)
    return raycaster
  }
  /**
   * 同一处同时命中好几份预览时，取**更具体**的那一份：点 > 线 > 面。
   * 交线的拐点上同时压着交点标记、交线命中带和它两边的交面片，用户点的是那个点；
   * 交线的边上压着交面片，点的是那条线；只有面片中间没有更具体的东西，才归交面。
   */
  const previewSpecificity = (kind: ThreeScenePreview["kind"]): number => kind === "point" ? 3 : kind === "intersection" ? 2 : kind === "face" ? 1 : 0
  /**
   * 指针落在哪一份预览上？用射线与预览命中区求交，阈值按屏幕像素给（与实体拾取同一套思路），
   * 这样"点击创建"只在真的指向预览时生效，不会抢走普通选择。
   *
   * **为什么点击时必须调用它一次**（而不是读 `pointermove` 维护的标志）：浏览器不需要在
   * `pointerdown` 之前先发 `pointermove`，只靠标志会让"原地点击"读到过期状态 —— 实测：剖切面
   * 确实在指针下，却因为标志是 `false` 而创建不了截面。
   *
   * 多份预览叠在一起时（交面片 + 它的交线轮廓）取**最近**的一份；距离几乎相同时优先交线：
   * 交线是细目标，用户特意指到那条线上，多半是想创建交线而不是交面。
   */
  const previewHitAt = (normalizedPoint: { x: number; y: number }): { hovering: boolean; depth: number | null; preview: ThreeScenePreview | null } => {
    const lookup = new Map<THREE.Object3D, ThreeScenePreview>()
    for (const [key, group] of previewGroups) {
      // 每轮同步建好的 key → 预览 表：这里不必再线性查找（预览数量会随实体数增长）。
      const preview = previewByKey.get(key)
      if (!preview) continue
      for (const target of (group.userData.hitTargets as THREE.Object3D[] | undefined) ?? []) lookup.set(target, preview)
    }
    if (lookup.size === 0) return { hovering: false, depth: null, preview: null }
    const hits = raycasterAt(normalizedPoint).intersectObjects([...lookup.keys()], false)
    let best: { distance: number; preview: ThreeScenePreview } | null = null
    for (const hit of hits) {
      const preview = lookup.get(hit.object)
      if (!preview) continue
      if (!best) { best = { distance: hit.distance, preview }; continue }
      const tolerance = Math.max(1e-3, hit.distance * 0.02)
      if (hit.distance < best.distance - tolerance) { best = { distance: hit.distance, preview }; continue }
      // 距离几乎相同（同一处同时命中好几份预览）时取**更具体**的那一份：点 > 线 > 面。
      if (Math.abs(hit.distance - best.distance) <= tolerance && previewSpecificity(preview.kind) > previewSpecificity(best.preview.kind)) {
        best = { distance: hit.distance, preview }
      }
    }
    return { hovering: best !== null, depth: best?.distance ?? null, preview: best?.preview ?? null }
  }
  /** 高亮是**就地改材质**：悬停不该触发内容重建（一次重建要重算整场几何）。 */
  const setPreviewHoverKey = (key: string | null) => {
    if (previewHoverKeyRef.current === key) return
    const previous = previewHoverKeyRef.current ? previewGroups.get(previewHoverKeyRef.current) : null
    previewHoverKeyRef.current = key
    if (previous) applyPreviewHighlight(previous, false)
    const next = key ? previewGroups.get(key) : null
    if (next) applyPreviewHighlight(next, true)
    if (sceneShell) sceneShell.dataset.previewHoverKey = key ?? ""
  }
  const updatePreviewHover = (event: PointerEvent) => {
    const point = pointFromEvent(event)
    const { hovering, preview } = previewHitAt(point)
    if (sceneShell) sceneShell.dataset.previewHovering = hovering ? "true" : "false"
    setPreviewHoverKey(preview?.key ?? null)
    // 状态栏要跟着指针换：从一份预览滑到另一份时，"这一份是什么、点下去创建什么"必须重新说一遍。
    if (preview && preview.key !== lastPreview?.key) {
      lastPreview = preview
      previewHoverRef.current?.(true, preview)
      previewHovering = true
      return
    }
    if (hovering === previewHovering) return
    previewHovering = hovering
    if (hovering && preview) previewHoverRef.current?.(true, preview)
    else if (lastPreview) previewHoverRef.current?.(false, lastPreview)
  }
  let previewHovering = false
  let lastPreview: ThreeScenePreview | null = null
  const handlePointerMoveForPreview = (event: PointerEvent) => updatePreviewHover(event)
  const handlePointerLeaveForPreview = () => {
    setPreviewHoverKey(null)
    if (!previewHovering) return
    previewHovering = false
    if (lastPreview) previewHoverRef.current?.(false, lastPreview)
  }

  /** `raycasterAt` / `previewHitAt` 也要给出去：抬起指针时的"点到预览了吗"判据与悬停共用同一套。 */
  return { raycasterAt, previewHitAt, handlePointerMoveForPreview, handlePointerLeaveForPreview }
}
