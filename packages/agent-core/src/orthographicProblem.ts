import { parseScalar } from "./verification/mathAnswerVerification"

/**
 * **有限三视图与体积双核验（W7 / T7，2026-11-08）**。
 *
 * ## 支持域（写死在这里，不随输入扩大）
 *
 * 只支持**轴对齐**的两类实体：
 * 1. 长方体 `宽×深×高`；
 * 2. 沿一整条棱切掉一个长方体后的 **L 形柱体**（切槽贯穿高度）。
 *
 * 视图身份固定：主视图 = 宽×高，俯视图 = 宽×深，左视图 = 深×高。
 * 圆柱、圆锥、斜截面、遮挡歧义、任意曲面一律 `unsupported` —— 不假装能重建。
 *
 * ## 三条硬判据
 *
 * 1. **共享轴必须一致**：主视图宽 = 俯视图宽、左视图宽 = 俯视图深、左视图高 = 主视图高。
 *    不一致时报 `view_identity_conflict`，**不重排标签**去凑一个"能解"的组合；
 * 2. **体积两条独立路径**：解析分块（底面积×高）与闭合网格的有向四面体求和。
 *    网格不闭合 / 两者不一致 → 不给数值；
 * 3. **不可观测参数保持自由**：切槽高度没给 ⇒ 候选体积不同 ⇒ 明确"信息不足"，
 *    不默认取 0、也不取"常见值"。
 *
 * 选项只在**算完之后**做匹配，绝不反向修改尺寸去迎合某个选项。
 */

export type OrthographicViewId = "front" | "top" | "side"

export interface OrthographicView {
  id: OrthographicViewId
  /** 视图的横向尺寸。 */
  width: number
  height: number
  unit?: string
  /** 只有俯视图允许：角上被切掉的长方形（沿视图宽/深方向）。 */
  notch?: { width: number; height: number }
}

export interface OrthographicProblemInput {
  problemRevision: string
  views: readonly OrthographicView[]
  /** 切槽沿高度的取值；`null`/缺省 = 题面没给（非唯一）。 */
  notchHeight?: number | null
  /** 题目声明的实体族；缺省按长方体/带角槽处理。 */
  family?: "cuboid" | "notched-cuboid" | string
  options?: readonly string[]
  tolerance?: number
}

export type OrthographicSolution =
  | {
    status: "answer"
    problemRevision: string
    dimensions: { width: number; depth: number; height: number }
    notch?: { width: number; depth: number; height: number }
    volume: number
    volumeText: string
    methods: { analytic: number; mesh: number }
    reprojection: "consistent"
    matchedOptions: string[]
  }
  | {
    status: "information_incomplete"
    problemRevision: string
    reasonCodes: string[]
    missingDimensions?: string[]
    candidates?: { volume: number; description: string }[]
  }
  | {
    status: "conflict"
    problemRevision: string
    code: "view_identity_conflict" | "dimension_conflict" | "unit_conflict"
    reason: string
    sourceViews: string[]
  }
  | { status: "unsupported"; problemRevision: string; reason: string }

type Vec3 = { x: number; y: number; z: number }

const VIEW_LABEL: Record<OrthographicViewId, string> = { front: "主视图", top: "俯视图", side: "左视图" }

function closeTo(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right))
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function viewOf(views: readonly OrthographicView[], id: OrthographicViewId): OrthographicView | undefined {
  return views.find((view) => view.id === id)
}

/** 底多边形（CCW）：矩形，或沿 `(maxX,maxY)` 角切掉一个长方形的 L 形。 */
function basePolygon(width: number, depth: number, notch?: { width: number; height: number }): [number, number][] {
  if (notch === undefined) return [[0, 0], [width, 0], [width, depth], [0, depth]]
  const cutX = width - notch.width
  const cutY = depth - notch.height
  return [[0, 0], [width, 0], [width, cutY], [cutX, cutY], [cutX, depth], [0, depth]]
}

interface MeshVolume {
  closed: boolean
  volume: number
  vertices: number
  triangles: number
}

/**
 * **闭合网格的有向四面体体积**（与解析分块是两条独立的路）。
 *
 * 多边形按 CCW 给出，先在 z=0 与 z=h 各铺一层三角面（顶面正绕、底面反绕），
 * 每条边再补一个外侧四边形。闭合性用"每条无向边恰好出现两次"检查。
 */
function meshVolumeOfPrism(polygon: readonly [number, number][], height: number): MeshVolume {
  const bottom = polygon.map(([x, y]) => ({ x, y, z: 0 }))
  const top = polygon.map(([x, y]) => ({ x, y, z: height }))
  const triangles: [Vec3, Vec3, Vec3][] = []
  for (let index = 1; index + 1 < polygon.length; index += 1) {
    triangles.push([top[0]!, top[index]!, top[index + 1]!])
    triangles.push([bottom[0]!, bottom[index + 1]!, bottom[index]!])
  }
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length
    const a = bottom[index]!
    const b = bottom[next]!
    const at = top[index]!
    const bt = top[next]!
    triangles.push([a, b, bt])
    triangles.push([a, bt, at])
  }

  const keyOf = (vertex: Vec3): string => `${vertex.x.toFixed(9)},${vertex.y.toFixed(9)},${vertex.z.toFixed(9)}`
  const edges = new Map<string, number>()
  for (const triangle of triangles) {
    for (let index = 0; index < 3; index += 1) {
      const first = keyOf(triangle[index]!)
      const second = keyOf(triangle[(index + 1) % 3]!)
      const key = [first, second].sort().join("|")
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  const closed = [...edges.values()].every((count) => count === 2)

  const cross = (left: Vec3, right: Vec3): Vec3 => ({
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x
  })
  let signed = 0
  for (const [a, b, c] of triangles) {
    const normal = cross(b, c)
    signed += (a.x * normal.x + a.y * normal.y + a.z * normal.z) / 6
  }
  return { closed, volume: Math.abs(signed), vertices: polygon.length * 2, triangles: triangles.length }
}

function matchedOptions(volume: number, options: readonly string[] | undefined, tolerance: number): string[] {
  if (options === undefined) return []
  const labels: string[] = []
  for (const option of options) {
    const label = /^\s*([A-Da-d])\s*[.、:：)．）]?\s*(.*)$/.exec(option)
    if (label === null) continue
    const value = parseScalar(label[2]!.replace(/[^\d./√+\-−\\sqrt{}]/g, ""))
    if (value !== undefined && closeTo(value, volume, tolerance)) labels.push(label[1]!.toUpperCase())
  }
  return labels
}

export function solveOrthographicProblem(input: OrthographicProblemInput): OrthographicSolution {
  const problemRevision = input.problemRevision
  const tolerance = input.tolerance ?? 1e-9
  const ids = new Set<OrthographicViewId>()
  for (const view of input.views) {
    if (!["front", "top", "side"].includes(view.id)) return { status: "unsupported", problemRevision, reason: `未知视图身份 ${String(view.id)}。` }
    if (ids.has(view.id)) return { status: "conflict", problemRevision, code: "dimension_conflict", reason: `${VIEW_LABEL[view.id]}出现了两次，无法确定以哪一份为准。`, sourceViews: [view.id] }
    ids.add(view.id)
    if (!finitePositive(view.width) || !finitePositive(view.height)) {
      return { status: "unsupported", problemRevision, reason: `${VIEW_LABEL[view.id]}的尺寸不是有限正数（${view.width}×${view.height}），无法构造实体。` }
    }
  }
  if (ids.size === 0) return { status: "unsupported", problemRevision, reason: "没有可用的三视图。" }

  if (input.family !== undefined && input.family !== "cuboid" && input.family !== "notched-cuboid") {
    return { status: "unsupported", problemRevision, reason: `当前只支持轴对齐长方体与 L 形柱体，不支持「${input.family}」。` }
  }

  const units = [...new Set(input.views.map((view) => view.unit).filter((unit): unit is string => unit !== undefined))]
  if (units.length > 1) {
    return { status: "conflict", problemRevision, code: "unit_conflict", reason: `三视图的单位不一致（${units.join(" / ")}），不能直接相乘。`, sourceViews: input.views.filter((view) => view.unit !== undefined).map((view) => view.id) }
  }

  const front = viewOf(input.views, "front")
  const top = viewOf(input.views, "top")
  const side = viewOf(input.views, "side")

  // 共享轴：三视图描述的是同一个实体的同一组边长。
  if (front !== undefined && top !== undefined && !closeTo(front.width, top.width, tolerance)) {
    return { status: "conflict", problemRevision, code: "view_identity_conflict", reason: `主视图宽 ${front.width} 与俯视图宽 ${top.width} 不是同一个 x 轴上的长度：视图身份或尺寸有冲突。`, sourceViews: ["front", "top"] }
  }
  if (top !== undefined && side !== undefined && !closeTo(top.height, side.width, tolerance)) {
    return { status: "conflict", problemRevision, code: "view_identity_conflict", reason: `俯视图深 ${top.height} 与左视图宽 ${side.width} 不是同一个 y 轴上的长度：视图身份或尺寸有冲突。`, sourceViews: ["top", "side"] }
  }
  if (front !== undefined && side !== undefined && !closeTo(front.height, side.height, tolerance)) {
    return { status: "conflict", problemRevision, code: "view_identity_conflict", reason: `主视图高 ${front.height} 与左视图高 ${side.height} 不是同一个 z 轴上的长度：视图身份或尺寸有冲突。`, sourceViews: ["front", "side"] }
  }

  const width = front?.width ?? top?.width
  const depth = top?.height ?? side?.width
  const height = front?.height ?? side?.height
  const missingDimensions = [
    ...(width === undefined ? ["width"] : []),
    ...(depth === undefined ? ["depth"] : []),
    ...(height === undefined ? ["height"] : [])
  ]
  if (width === undefined || depth === undefined || height === undefined) {
    return { status: "information_incomplete", problemRevision, reasonCodes: ["missing_dimension"], missingDimensions }
  }

  const notch = top?.notch
  if (notch !== undefined) {
    if (!finitePositive(notch.width) || !finitePositive(notch.height) || notch.width > width || notch.height > depth) {
      return { status: "conflict", problemRevision, code: "dimension_conflict", reason: `俯视图的切槽 ${notch.width}×${notch.height} 超出实体底面 ${width}×${depth}。`, sourceViews: ["top"] }
    }
  }

  const baseArea = width * depth
  const notchArea = notch === undefined ? 0 : notch.width * notch.height
  const analyticWithoutNotchDepth = baseArea * height
  const notchVolume = notchArea * height

  if (notch !== undefined && (input.notchHeight === undefined || input.notchHeight === null)) {
    // 槽高不可观测：候选体积不同 ⇒ 信息不足，不替题面选一个值。
    return {
      status: "information_incomplete",
      problemRevision,
      reasonCodes: ["non_unique_volume"],
      candidates: [
        { volume: analyticWithoutNotchDepth - notchVolume, description: `切槽贯穿高度 ${height}` },
        { volume: analyticWithoutNotchDepth, description: "切槽深度趋近 0（俯视图仍可见切口）" }
      ]
    }
  }
  const notchHeight = notch === undefined ? undefined : input.notchHeight
  if (notchHeight !== undefined && notchHeight !== null && (!finitePositive(notchHeight) || notchHeight > height)) {
    return { status: "conflict", problemRevision, code: "dimension_conflict", reason: `切槽高度 ${notchHeight} 不在 (0, ${height}] 内。`, sourceViews: ["top", "front"] }
  }

  const analytic = analyticWithoutNotchDepth - (notchHeight === undefined || notchHeight === null ? 0 : notchArea * notchHeight)
  const polygon = basePolygon(width, depth, notch)
  const mesh = meshVolumeOfPrism(polygon, height)
  if (!mesh.closed) {
    return { status: "information_incomplete", problemRevision, reasonCodes: ["mesh_volume_unavailable"] }
  }
  if (!closeTo(mesh.volume, analytic, Math.max(tolerance, 1e-7))) {
    return {
      status: "information_incomplete",
      problemRevision,
      reasonCodes: ["method_disagreement"],
      candidates: [{ volume: analytic, description: "解析分块" }, { volume: mesh.volume, description: "闭合网格" }]
    }
  }

  const volume = analytic
  return {
    status: "answer",
    problemRevision,
    dimensions: { width, depth, height },
    ...(notch === undefined ? {} : { notch: { width: notch.width, depth: notch.height, height: notchHeight ?? height } }),
    volume,
    volumeText: `${Number(volume.toPrecision(10))}${units[0] === undefined ? "" : ` ${units[0]}³`}`,
    methods: { analytic, mesh: mesh.volume },
    reprojection: "consistent",
    matchedOptions: matchedOptions(volume, input.options, Math.max(tolerance, 1e-9))
  }
}
