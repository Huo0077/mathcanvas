/**
 * 点标注（画布上的 A/B/C… 字母）的屏幕位置。
 *
 * **投影的是画面上那个对象，而不是文档里的坐标。** 拖动期间文档**不提交**（画面全靠加在 Three.js 对象
 * 位置上的临时偏移），按文档坐标投影会让标注留在原地：手把实体拖走了，字母却钉在原处——用户实测反馈
 * "现在圆柱上的点又不跟着动了"说的就是这个（点手柄自己跟着走了，字母没跟）。
 *
 * 对象找不到时（还没同步、或这个点没画出来）如实退回文档坐标：宁可按旧位置画，也不画到别处去。
 */
import * as THREE from "three"

import type { Vector3 } from "@draw/dsl"

/** 与 `syncOverlay` 的条目形状一致（`threeScene.tsx` 里那块 HTML 覆盖层）。 */
export interface PointLabelPlacement {
  key: string
  text: string
  visible: boolean
  left: number
  top: number
  dataset: { pointLabel: string; pointId: string }
}

export function pointLabelPlacements(
  points: readonly { id: string; position: Vector3; label?: string }[],
  objectOf: (id: string) => THREE.Object3D | null | undefined,
  camera: THREE.Camera,
  size: { width: number; height: number },
  scratch = new THREE.Vector3()
): PointLabelPlacement[] {
  return points.map((point) => {
    const object = objectOf(point.id)
    if (object) object.getWorldPosition(scratch)
    else scratch.set(point.position.x, point.position.y, point.position.z)
    // `project` 会把世界坐标就地写成分屏幕坐标，所以每次都要重新从世界坐标出发。
    const projected = scratch.clone().project(camera)
    const label = point.label ?? point.id
    return {
      key: point.id,
      text: label,
      visible: projected.z >= -1 && projected.z <= 1,
      // 点标记的半径是固定像素，所以标注也按像素偏移，不随缩放漂移。
      left: (projected.x * 0.5 + 0.5) * size.width + 10,
      top: (-projected.y * 0.5 + 0.5) * size.height - 10,
      dataset: { pointLabel: label, pointId: point.id }
    }
  })
}
