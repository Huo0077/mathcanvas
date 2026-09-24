import type { PrimitiveSpec } from "@draw/dsl"

/**
 * **属性检查器里的数**（纯函数，从 `PropertiesBar.tsx` 拆出）。
 *
 * 这些函数只做一件事：把文档里存的数**显示成用户能读的数**，以及把它读回来。
 * 单独一个文件而不是混在组件里，有两个理由：
 *
 * 1. 它们与 React 无关，可以单独测、单独读 —— 而 `PropertiesBar.tsx` 有近千行面板 JSX；
 * 2. `react-refresh/only-export-components` 要求"只导出组件"的文件才能热更新：
 *    一个文件既导出组件又导出函数时，改一次函数会让整块面板丢掉状态。
 *
 * ## 三条纪律（原实现就在守，搬动时逐字保留）
 *
 * 1. **显示用度、存储用弧度**：`rotationDegrees` / `rotationRadians` 是两者之间**唯一**的换向点。
 *    面板里各处直接写 `x * 180 / Math.PI` 的话，迟早有一处漏掉。
 * 2. **`displayDegrees` 要四舍五入到两位**：45° / 90° 这类预设值经过弧度往返会变成
 *    44.999999，直接显示出来像是系统没记住用户输入。
 * 3. **`placementDegrees` 折算到 0°..360°**：绕定点的转角是**有符号**的，负角折回正区间，
 *    否则界面上会出现 "-0°" 这种读数。
 */

/** 直线类图元（线 / 线段 / 射线）—— 斜率、倾角、长度三条读数共用它。 */
export type LinearPrimitive = Extract<PrimitiveSpec, { type: "line" | "segment" | "ray" }>

export function numberValue(event: { target: { value: string } }): number {
  return Number(event.target.value)
}

export function rotationDegrees(rotation = 0): number {
  return rotation * 180 / Math.PI
}

/** 绕定点的转角读数：折算成 0°..360°，负角折回正区间。 */
export function placementDegrees(angle = 0): number {
  const degrees = (angle * 180 / Math.PI) % 360
  return degrees < 0 ? degrees + 360 : degrees
}

export function rotationRadians(degrees: number): number {
  return degrees * Math.PI / 180
}

/** Degrees shown to the user, rounded so a 45 or 90 preset never reads back as 44.999999. */
export function displayDegrees(radians: number): number {
  return Number((radians * 180 / Math.PI).toFixed(2))
}

/** 绕 `center` 把 (x, y) 转 `rotation` 弧度 —— 圆锥曲线的顶点 / 焦点读数用它。 */
export function rotatePoint(center: { x: number; y: number }, x: number, y: number, rotation: number): { x: number; y: number } {
  return { x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation), y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation) }
}

/** 垂直线没有斜率（返回 `null`），而不是给一个 `Infinity` 让界面自己去猜。 */
export function lineSlope(line: LinearPrimitive): number | null {
  const deltaX = line.b.x - line.a.x
  return Math.abs(deltaX) < 1e-9 ? null : (line.b.y - line.a.y) / deltaX
}

export function lineAngle(line: LinearPrimitive): number {
  return Math.atan2(line.b.y - line.a.y, line.b.x - line.a.x) * 180 / Math.PI
}

export function lineLength(line: LinearPrimitive): number {
  return Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y)
}
