import * as THREE from "three"

import { GRID_FADE_START_RATIO, GRID_MAJOR_EVERY } from "./sceneGrid"

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
 *
 * ## 远处的淡出（2026-10-01："把 0 平面做成无限延伸的感觉"）
 *
 * 栅格铺不到无穷远（1 格 = 1 单位、按 2 的幂分档），所以做法是**让它到边界之前化开**。
 * 这里用**顶点色**实现：把"离块中心多远"烘进每个顶点的颜色 —— 淡出起点以内是格线色，
 * 到边界处正好是**纸色**（等于化进纸里），中间按 smoothstep 过渡。
 *
 * **为什么每条线要打断**：顶点色在一条线段上是线性插值的。若一根从 −R 到 +R 的线只给两端顶点色，
 * 两端都是"纸色"、中点被插值成"两个纸色的平均" ⇒ **整根线都是纸色，等于没画**。
 * 所以在淡出带里按"到中心的距离 = start / 中点 / end"解出交点、把线切成几段，逐段两端各自烘色；
 * 带外（近处、极远处）不切，顶点数不会爆。
 *
 * **为什么不用着色器**：同一天我先试过自定义 `ShaderMaterial`（片元里 `smoothstep` 到 0）——
 * 它编译通过、控制台无报错，却**一个像素都没画出来**（实测截图纯白）。顶点色走的是既有材质通道，
 * 不碰自定义 GLSL，也就不会重演那次"编译通过但看不见"。
 */
export interface GridGeometryOptions {
  /** 每几格画一条线（默认 1）。主线传 `GRID_MAJOR_EVERY`。 */
  every?: number
  /** 跳过这个倍数的线（细线传 `GRID_MAJOR_EVERY`，避免与主线重叠绘制）。 */
  skipMultiplesOf?: number
  /**
   * 本层格线色。**给了它才会写 `color` 属性**（顶点色）；没给就与老几何逐字节一致。
   * 材质那边要配 `vertexColors: true`，并把 `material.color` 留成白色（颜色全在顶点里）。
   */
  color?: string
  /** 淡出区间（半径，世界单位）。缺省不淡出（整条线都是格线色）。 */
  fade?: { start: number; end: number }
  /** 淡出的终点色 = **纸色**（与 `--color-graph-paper` 同源）。 */
  paper?: string
}

/** 平滑过渡（与着色器里的 `smoothstep` 同一形状），免得淡出带边缘出现一条生硬的色阶。 */
function smoothstep(edge0: number, edge1: number, value: number): number {
  if (!(edge1 > edge0)) return value >= edge1 ? 1 : 0
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** 一条平行于 X 的线（y = offset）上，到块中心的距离等于 target 的那两个 x（没有则返回空）。 */
function crossingsAt(extent: number, offset: number, target: number): number[] {
  const squared = target * target - offset * offset
  if (!(squared > 0)) return []
  const distance = Math.sqrt(squared)
  if (!(distance < extent)) return []
  return [-distance, distance]
}

export function buildGridGeometry(radius: number, options: GridGeometryOptions = {}): THREE.BufferGeometry {
  const rounded = Math.max(1, Math.round(radius))
  const every = Math.max(1, Math.round(options.every ?? 1))
  const skip = options.skipMultiplesOf
  const positions: number[] = []
  const colors: number[] = []
  const lineColor = options.color ? new THREE.Color(options.color) : null
  const paperColor = new THREE.Color(options.paper ?? GRAPH_PAPER_COLOR)
  const fadeStart = options.fade ? Math.max(0, options.fade.start) : Number.POSITIVE_INFINITY
  const fadeEnd = options.fade ? Math.max(options.fade.start, options.fade.end) : Number.POSITIVE_INFINITY
  const fading = lineColor !== null && Number.isFinite(fadeStart) && fadeEnd > fadeStart

  /** 把一条从 −rounded 到 +rounded 的线按淡出带切成若干段，逐顶点烘色。 */
  const pushLine = (fixedAxis: "x" | "y", offset: number) => {
    const along = fading
      ? [0, ...crossingsAt(rounded, offset, fadeStart), ...crossingsAt(rounded, offset, (fadeStart + fadeEnd) / 2), ...crossingsAt(rounded, offset, fadeEnd)]
      : []
    const stops = [...new Set([-rounded, ...along, rounded])].sort((left, right) => left - right)
    for (let index = 0; index < stops.length - 1; index += 1) {
      for (const value of [stops[index], stops[index + 1]]) {
        if (fixedAxis === "x") positions.push(value, offset, 0)
        else positions.push(offset, value, 0)
        if (lineColor) {
          const ratio = fading ? smoothstep(fadeStart, fadeEnd, Math.hypot(value, offset)) : 0
          colors.push(
            lineColor.r + (paperColor.r - lineColor.r) * ratio,
            lineColor.g + (paperColor.g - lineColor.g) * ratio,
            lineColor.b + (paperColor.b - lineColor.b) * ratio
          )
        }
      }
    }
  }

  for (let index = -rounded; index <= rounded; index += 1) {
    if (index % every !== 0) continue
    if (skip && index % skip === 0) continue
    // 平行于 Y 的线（x = index）与平行于 X 的线（y = index）
    pushLine("y", index)
    pushLine("x", index)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  if (lineColor) geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

/**
 * 栅格两层的颜色与"每格占多少像素才看得清"的淡出曲线。
 *
 * **两端同源**：平面几何的画布格线走 CSS 令牌 `--color-graph-grid-minor` / `--color-graph-grid-major`
 * （见 `styles/tokens.css`），three.js 这边读不到 CSS 变量，只能各写一份**同样的值**。
 * 改一处就要改两处 —— `threeGrid.test.ts` 与 `e2e/three-ui-tokens.spec.ts` 都会盯着这组值。
 *
 * 2026-09-18 视觉重构把两个画布整体转成冷色调（画布由淡黄草稿纸改成冷白纸）。
 * **2026-10-01 当天曾试过改回暖纸**（用户口径"整个 UI 风格换成淡黄色"＋"纸质感"），
 * 当天即按 **"太丑了，还是回退吧"整体回退**（调色改动留在 `git stash`，见 CHANGELOG 同日一节）。
 * 同日还有一条用户口径"网格怎么没了 / 我要的是网格无限延伸的感觉"：原先那组格线色
 * （`#eef2f7` 压在白纸上只差 6%）本来就看不清，格线提到 `#cdd8e6` / `#aebccf`，
 * 淡出改走**顶点色**（见 `buildGridGeometry`）。
 */
export const GRID_MINOR_COLOR = "#cdd8e6"
export const GRID_MAJOR_COLOR = "#aebccf"

/** 纸色（与 `--color-graph-paper` 同源）：顶点色淡出的终点色，等于"化进纸里"。 */
export const GRAPH_PAPER_COLOR = "#ffffff"

/** 与 `--color-graph-grid-*` 的对应关系（供测试与文档核对，避免"改了这里忘了那边"）。 */
export const GRAPH_PAPER_GRID_TOKENS = { minor: "--color-graph-grid-minor", major: "--color-graph-grid-major" } as const

export function gridLayerOpacity(pixelsPerCell: number): number {
  // 一格小于 1.5px 时完全看不见、大于 4.5px 时完全可见：中间线性过渡，避免远处糊成一片灰。
  return Math.max(0, Math.min(1, (pixelsPerCell - 1.5) / 3))
}

/**
 * 栅格**远处淡出**的区间（世界单位，半径）。
 *
 * 用户口径："把 0 平面也就是 z=0 的格子网做成无限延伸的感觉。"
 *
 * 栅格终究是一块有限方块，所以做法不是铺到无穷大，而是**让它到边界之前化开**：
 * 内圈全实（清晰可读）、外圈渐隐，到 `end`（= 覆盖半径）处正好是纸色，那条边因此永远看不见。
 *
 * `start` 由 `GRID_FADE_START_RATIO` 决定，而这个比例也是**覆盖率**那条计算的依据：
 * 档位要选到"满实区仍然盖住可见地面脚印"（见 `sceneGrid.ts`）。
 */
export function gridFadeBand(extent: number): { start: number; end: number } {
  if (!Number.isFinite(extent) || extent <= 0) return { start: 0, end: 0 }
  return { start: extent * GRID_FADE_START_RATIO, end: extent }
}

export { GRID_MAJOR_EVERY, GRID_FADE_START_RATIO }
