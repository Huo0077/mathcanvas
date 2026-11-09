import type { Outline2D, OutlinePoint2D } from "@draw/geometry-kernel"
import { outlinesAgree, projectPrismViews, projectPyramidViews } from "@draw/geometry-kernel"

/**
 * **三视图候选与"唯一体积"判据（W7，2026-11-09）**。
 *
 * 核心问题：同一组三视图外轮廓可以对应**多个实体**（同底棱柱/棱锥、切槽深浅…），
 * 于是体积可能不同。两条纪律：
 *
 * 1. **只有通过反投影的候选**才进入合并（`reprojectionPassed`）—— 尺寸对得上不等于形状对得上；
 * 2. **候选清单必须覆盖有限支持域**：只有一个候选时，除非声明"域已枚举完"，否则**不许**称唯一。
 *
 * 返回 `unique_value` 只在"所有通过反投影的候选体积相同"且支持域完整时给出；
 * 否则 `ambiguous`（交给澄清），或 `none`（一个都没通过）。
 */

export type OrthographicFamily = "cuboid" | "notched-cuboid" | "right-prism" | "right-pyramid"

export const DEFAULT_ORTHOGRAPHIC_FAMILIES: readonly OrthographicFamily[] = [
  "cuboid", "notched-cuboid", "right-prism", "right-pyramid"
]

export interface DeclaredView {
  width: number
  height: number
  /** 题面给出的轮廓顶点数（矩形 4、L 形 6、三角形 3）。缺省时不比较顶点数。 */
  vertexCount?: number
}

export interface CandidateViews {
  front: DeclaredView
  top: DeclaredView
  side: DeclaredView
  /** 俯视图的角槽（L 形柱体）；没有就不是 L 形。 */
  notch?: { width: number; height: number }
  /** 俯视图的真实底面轮廓（图像管线给出的结构化视图）；没有就不能算不规则棱柱体积。 */
  topOutline?: readonly OutlinePoint2D[]
}

export interface VolumeCandidate {
  id: string
  family: OrthographicFamily
  volume: number
  reprojectionPassed: boolean
  reasonCodes: string[]
}

export interface CandidateInput {
  views: CandidateViews
  families?: readonly OrthographicFamily[]
  tolerance?: number
}

const TOLERANCE = 1e-9

function closeTo(left: number, right: number, tolerance = TOLERANCE): boolean {
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right))
}

function declared(view: DeclaredView): Outline2D {
  return { width: view.width, height: view.height, vertices: [], ...(view.vertexCount === undefined ? {} : { vertexCount: view.vertexCount }) }
}

function rectangleBase(width: number, depth: number): OutlinePoint2D[] {
  return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }]
}

function notchedBase(width: number, depth: number, notch: { width: number; height: number }): OutlinePoint2D[] {
  const cutX = width - notch.width
  const cutY = depth - notch.height
  return [
    { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: cutY },
    { x: cutX, y: cutY }, { x: cutX, y: depth }, { x: 0, y: depth }
  ]
}

function polygonArea(points: readonly OutlinePoint2D[]): number {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    sum += current.x * next.y - next.x * current.y
  }
  return Math.abs(sum) / 2
}

function checkViews(views: CandidateViews, projected: { front: Outline2D; top: Outline2D; side: Outline2D }): string[] {
  const reasonCodes: string[] = []
  for (const id of ["front", "top", "side"] as const) {
    const agreement = outlinesAgree(declared(views[id]), projected[id])
    if (!agreement.ok) reasonCodes.push(...agreement.reasonCodes.map((code) => `${id}:${code}`))
  }
  return reasonCodes
}

/** 按支持域枚举候选实体，逐个做轮廓反投影。 */
export function orthographicCandidateVolumes(input: CandidateInput): VolumeCandidate[] {
  const tolerance = input.tolerance ?? TOLERANCE
  const families = input.families ?? DEFAULT_ORTHOGRAPHIC_FAMILIES
  const { views } = input
  const width = views.top.width
  const depth = views.top.height
  const height = views.front.height
  if (![width, depth, height].every((value) => Number.isFinite(value) && value > 0)) return []

  const candidates: VolumeCandidate[] = []
  for (const family of families) {
    if (family === "cuboid") {
      const projected = projectPrismViews(rectangleBase(width, depth), height, tolerance)
      if (projected === null) continue
      const reasonCodes = checkViews(views, projected)
      candidates.push({ id: family, family, volume: width * depth * height, reprojectionPassed: reasonCodes.length === 0, reasonCodes })
      continue
    }
    if (family === "notched-cuboid") {
      const notch = views.notch
      if (notch === undefined) {
        candidates.push({ id: family, family, volume: Number.NaN, reprojectionPassed: false, reasonCodes: ["notch_missing"] })
        continue
      }
      const projected = projectPrismViews(notchedBase(width, depth, notch), height, tolerance)
      if (projected === null) continue
      const reasonCodes = checkViews(views, projected)
      candidates.push({
        id: family, family,
        volume: (width * depth - notch.width * notch.height) * height,
        reprojectionPassed: reasonCodes.length === 0,
        reasonCodes
      })
      continue
    }
    if (family === "right-prism") {
      const outline = views.topOutline
      if (outline === undefined) {
        // 俯视图只给了包围盒：底面形状不可观测，不能凭空算体积。
        candidates.push({ id: family, family, volume: Number.NaN, reprojectionPassed: false, reasonCodes: ["outline_missing"] })
        continue
      }
      const projected = projectPrismViews(outline, height, tolerance)
      if (projected === null) continue
      const reasonCodes = checkViews(views, projected)
      candidates.push({ id: family, family, volume: polygonArea(outline) * height, reprojectionPassed: reasonCodes.length === 0, reasonCodes })
      continue
    }
    const projected = projectPyramidViews(width, depth, height, tolerance)
    if (projected === null) continue
    const reasonCodes = checkViews(views, projected)
    candidates.push({ id: family, family, volume: (width * depth * height) / 3, reprojectionPassed: reasonCodes.length === 0, reasonCodes })
  }
  return candidates
}

export interface InvariantVolumeInput {
  candidates: readonly VolumeCandidate[]
  tolerance?: number
  /** 支持域是否已**完整枚举**；`false` 时即使只有一个候选也不称唯一。 */
  domainComplete?: boolean
}

export type InvariantVolume =
  | { status: "unique_value"; volume: number; candidateIds: string[] }
  | { status: "ambiguous"; volumes: number[]; candidateIds: string[]; domainComplete: boolean }
  | { status: "none"; reason: string }

/**
 * 合并已通过反投影的候选体积。
 *
 * `resolveInvariantVolume(candidates, 1e-9)` —— 第二个位置参数是容差（与计划里的签名一致）。
 */
export function resolveInvariantVolume(
  candidates: readonly VolumeCandidate[],
  tolerance = TOLERANCE,
  options: { domainComplete?: boolean } = {}
): InvariantVolume {
  const domainComplete = options.domainComplete ?? true
  if (candidates.length === 0) return { status: "none", reason: "no_candidate" }
  const passed = candidates.filter((candidate) => candidate.reprojectionPassed && Number.isFinite(candidate.volume) && candidate.volume > 0)
  if (passed.length === 0) return { status: "none", reason: "no_reprojected_candidate" }

  const volumes: number[] = []
  for (const candidate of passed) {
    if (!volumes.some((value) => closeTo(value, candidate.volume, tolerance))) volumes.push(candidate.volume)
  }
  const candidateIds = passed.map((candidate) => candidate.id)
  if (volumes.length === 1 && domainComplete) return { status: "unique_value", volume: volumes[0]!, candidateIds }
  return { status: "ambiguous", volumes, candidateIds, domainComplete }
}
