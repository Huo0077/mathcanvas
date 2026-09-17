import * as THREE from "three"

import { GRID_MAJOR_EVERY } from "./sceneGrid"

/**
 * 背景栅格的几何。
 *
 * 用户反馈："立体缩放不要改变网格图大小，网格大小要严格对应一比一。"
 * 所以这里按**整世界单位**铺线：1 格 = 1 单位，覆盖 `[-radius, radius]`，
 * 每 `majorEvery` 格一条主线。
 *
 * 细线与主线是**两份几何**（各自一个材质），因为缩得很远时要把细线淡出、只留主线——
 * 而两者的间距都必须是精确的整数单位，所以几何本身按整数建，不随缩放改变。
 * 栅格直接建在 XY 平面（世界 Z 朝上），不再需要"把 XZ 网格转 90°"那种补丁。
 */
export interface GridGeometryOptions {
  /** 每几格画一条线（默认 1）。主线传 `GRID_MAJOR_EVERY`。 */
  every?: number
  /** 跳过这个倍数的线（细线传 `GRID_MAJOR_EVERY`，避免与主线重叠绘制）。 */
  skipMultiplesOf?: number
}

export function buildGridGeometry(radius: number, options: GridGeometryOptions = {}): THREE.BufferGeometry {
  const rounded = Math.max(1, Math.round(radius))
  const every = Math.max(1, Math.round(options.every ?? 1))
  const skip = options.skipMultiplesOf
  const positions: number[] = []
  for (let index = -rounded; index <= rounded; index += 1) {
    if (index % every !== 0) continue
    if (skip && index % skip === 0) continue
    // 平行于 Y 的线（x = index）与平行于 X 的线（y = index）
    positions.push(index, -rounded, 0, index, rounded, 0)
    positions.push(-rounded, index, 0, rounded, index, 0)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

/** 栅格两层的颜色与"每格占多少像素才看得清"的淡出曲线。 */
export const GRID_MINOR_COLOR = "#e2e6ef"
export const GRID_MAJOR_COLOR = "#aeb8cf"

export function gridLayerOpacity(pixelsPerCell: number): number {
  // 一格小于 1.5px 时完全看不见、大于 4.5px 时完全可见：中间线性过渡，避免远处糊成一片灰。
  return Math.max(0, Math.min(1, (pixelsPerCell - 1.5) / 3))
}

export { GRID_MAJOR_EVERY }
