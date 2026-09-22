import { triangleCenter2, validatePrismInput, type Vector3 } from "@draw/geometry-kernel"

import type { PlanDiagnostic, StructuredAssumption } from "./contracts"
import { DEFAULT_DYNAMIC_POINT_PARAMETER, DEFAULT_PRISM_HEIGHT, DEFAULT_PRISM_SPAN, DEFAULT_SLOPE, WITNESS_TRIANGLE, defaultPrismBasePolygon, defaultPrismVector } from "./localPlanDefaults"

/**
 * **欠定题目的特值选择**（Agent DSL 切片 Task 3；规格 §6.3）。
 *
 * ```
 * 欠定选择优先级：满足显式约束、保持非退化、避免特殊对称、使用小整数、最小化复杂度。
 * 若问题要求"任意""恒定""定值"，必须保留符号参数，不能特值化成单点。
 * ```
 *
 * ## 这个文件唯一真正难的地方：什么时候**不许**选特值
 *
 * "欠定就取个默认值"听起来无害，但它会**悄悄改掉题目的性质**：
 * "求证 θ 任意时 9/OA² + 4/OB² 恒为 1" 一旦把 θ 特值成 0.4，那份计划就不再证明任何东西 ——
 * 它变成了"我试了一个角度，结果是 1"。规格因此把符号保留写成**硬要求**，而这里的实现顺序
 * 也照它来：先看题目是不是在说"任意/恒定/定值"，是就返回符号结果，
 * **根本不进入候选特值的挑选**。
 *
 * ## 判据来自内核，不是这里自己发明
 *
 * "非退化"的判据必须与真正算几何的那份实现同源，否则会出现"这里认为成立、
 * 内核认为退化"的分叉。所以：
 * - 三角形 → `triangleCenter2("circumcenter", …)`（共线时内核报 `degenerate`）；
 * - 棱柱 → `validatePrismInput`（重合顶点、零面积、不共面、自交、零体积）。
 *
 * 于是这一层没有第二套几何判据，只有"挑哪个候选"这件事。
 */

export type WitnessKind = "triangle" | "slope" | "prism" | "moving_point"

export interface Point2 {
  x: number
  y: number
}

export interface TriangleWitness {
  a: Point2
  b: Point2
  c: Point2
}

export interface PrismWitness {
  basePolygon: Vector3[]
  vector: Vector3
}

export type WitnessValue =
  | ({ kind: "triangle" } & TriangleWitness)
  | { kind: "slope"; value: number }
  | ({ kind: "prism" } & PrismWitness)
  | { kind: "moving_point"; parameter: number }

/** 题目要求保留的符号参数（不做特值化）。 */
export interface SymbolicWitness {
  symbols: readonly string[]
  reason: string
}

export interface WitnessConstraints {
  triangle?: TriangleWitness
  slope?: number
  prism?: PrismWitness
  /** 只给拉伸向量时的便捷写法（底面用默认值）。 */
  vector?: Vector3
  parameter?: number
}

export interface WitnessRequest {
  kind: WitnessKind
  /** 用户原话：`任意/恒定/定值` 这类要求只看它（不看模型的转述）。 */
  prompt?: string
  constraints?: WitnessConstraints
}

export type WitnessSelection =
  | { status: "witness"; value: WitnessValue; assumption: StructuredAssumption; considered: readonly string[]; diagnostics: PlanDiagnostic[] }
  | { status: "symbolic"; value: SymbolicWitness; assumption: StructuredAssumption; considered: readonly string[]; diagnostics: PlanDiagnostic[] }
  | { status: "rejected"; value: null; diagnostics: PlanDiagnostic[]; considered: readonly string[] }

/** "任意/恒定/定值"这类要求。**判据只有一个**：这一层与提示词共用同一份关键词。 */
const SYMBOLIC_KEYWORDS = ["任意", "恒", "定值", "不变", "全都成立", "invariant", "arbitrary", "for all", "any point", "constant"]

export function isInvariantRequest(prompt: string | undefined): boolean {
  if (!prompt) return false
  const lowered = prompt.toLowerCase()
  return SYMBOLIC_KEYWORDS.some((keyword) => lowered.includes(keyword.toLowerCase()))
}

/** 每个族在"必须保留符号"时留下的符号名。 */
const SYMBOLS_BY_KIND: Record<WitnessKind, readonly string[]> = {
  triangle: ["A", "B", "C"],
  slope: ["k"],
  prism: ["a", "h"],
  moving_point: ["t"]
}

function symbolicSelection(kind: WitnessKind, considered: string[]): WitnessSelection {
  const symbols = SYMBOLS_BY_KIND[kind]
  const reason = `题目要求"任意/恒定/定值"：必须保留符号参数 ${symbols.join("、")}，不能特值化成一组数字。`
  return {
    status: "symbolic",
    value: { symbols, reason },
    assumption: { id: `witness:${kind}`, text: reason, kind: "symbolic", value: { symbols }, overridable: false, path: `witness.${kind}` },
    considered,
    diagnostics: []
  }
}

function rejectedSelection(kind: WitnessKind, code: string, detail: string, considered: string[]): WitnessSelection {
  return {
    status: "rejected",
    value: null,
    diagnostics: [{ stage: "geometry_validation", code, path: `witness.${kind}`, detail, severity: "error" }],
    considered
  }
}

// ---------------------------------------------------------------- 非退化判据（内核）

/** 三角形是不是非退化：判据来自内核的外心求解（共线时它会报 `degenerate`）。 */
export function validateTriangleWitness(triangle: TriangleWitness): { ok: true } | { ok: false; reason: string } {
  const result = triangleCenter2("circumcenter", triangle.a, triangle.b, triangle.c)
  if (result.status === "exact") return { ok: true }
  // `approximate` 走不到这里（外心是闭式解），但判别联合必须穷尽 —— 顺手把它说清。
  if (result.status === "approximate") return { ok: false, reason: `外心只解出数值近似（残差 ${result.residual.toPrecision(3)}），不作为特值。` }
  return { ok: false, reason: result.reason }
}

/** 棱柱候选是不是真的能拉伸成实体：判据来自内核的 `validatePrismInput`。 */
export function validatePrismWitness(basePolygon: readonly Vector3[], vector: Vector3): { ok: true } | { ok: false; reason: string } {
  const result = validatePrismInput(basePolygon, vector)
  return result.ok ? { ok: true } : { ok: false, reason: result.diagnostics.map((entry) => entry.message).join("；") }
}

function sideLengths(triangle: TriangleWitness): [number, number, number] {
  const { a, b, c } = triangle
  return [Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - b.x, c.y - b.y), Math.hypot(a.x - c.x, a.y - c.y)]
}

/**
 * **避免特殊对称**（优先级第三条）。
 *
 * 等边、等腰、直角都会让"一般性结论"出现巧合：外心与内心重合、外接圆半径等于某个边长、
 * 直角让某个交点恰好落在线段端点。用户拿这种特值去核对题目时会被误导，所以生成的候选
 * 一律要求三边互不相等、且没有直角。**显式给定的三角形不受这条限制** ——
 * 那是用户的选择，不是我们的默认。
 */
export function isNonSpecialTriangle(triangle: TriangleWitness): boolean {
  const [first, second, third] = sideLengths(triangle)
  const scale = Math.max(first, second, third)
  if (scale <= 0) return false
  const tolerance = scale * 1e-9
  if (Math.abs(first - second) <= tolerance || Math.abs(second - third) <= tolerance || Math.abs(first - third) <= tolerance) return false
  const { a, b, c } = triangle
  const dot = (first: Point2, second: Point2, third: Point2) => (second.x - first.x) * (third.x - first.x) + (second.y - first.y) * (third.y - first.y)
  const products = [dot(a, b, c), dot(b, a, c), dot(c, a, b)]
  // 直角判据用面积尺度归一：`|u·v| <= 1e-9 * |u||v|`。
  const rightAngle = Math.abs(dot(a, b, c)) / (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - a.x, c.y - a.y))
  return products.every((value) => Number.isFinite(value)) && rightAngle > 1e-9
}

/** 生成的候选三角形，按优先级的顺序（规格 §6.3 的特值第一个）。 */
export function witnessTriangleCandidates(): readonly TriangleWitness[] {
  return [
    { a: { ...WITNESS_TRIANGLE.a }, b: { ...WITNESS_TRIANGLE.b }, c: { ...WITNESS_TRIANGLE.c } },
    { a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, c: { x: 0, y: 2 } },
    { a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, c: { x: 0, y: 3 } }
  ]
}

/** 按顺序挑第一个"非退化且非特殊"的三角形；一个都没有时返回 `null`（绝不硬塞一个退化的）。 */
export function firstAcceptableTriangle(
  candidates: readonly TriangleWitness[]
): { triangle: TriangleWitness; considered: string[] } | null {
  const considered: string[] = []
  for (const candidate of candidates) {
    const validated = validateTriangleWitness(candidate)
    if (!validated.ok) {
      considered.push(`degenerate: ${validated.reason}`)
      continue
    }
    if (!isNonSpecialTriangle(candidate)) {
      considered.push("symmetry: 等边 / 等腰 / 直角这类特殊对称会掩盖一般性，跳过。")
      continue
    }
    considered.push("accepted: 非退化、非特殊、小整数。")
    return { triangle: { a: { ...candidate.a }, b: { ...candidate.b }, c: { ...candidate.c } }, considered }
  }
  return null
}

// ---------------------------------------------------------------- 选择入口

function pointText(point: Point2): string {
  return `(${point.x}, ${point.y})`
}

/**
 * **挑一个满足显式约束、非退化、非特殊、尽量小的特值**（规格 §6.3）。
 *
 * 顺序就是优先级：题目要求符号 → 返回符号；显式约束 → 原样用（退化则**拒绝**）；
 * 都没有 → 按候选顺序挑第一个可接受的。
 */
export function selectWitness(request: WitnessRequest): WitnessSelection {
  const considered: string[] = []

  if (isInvariantRequest(request.prompt)) {
    considered.push("symbolic: 题目要求任意/恒定，保留符号参数。")
    return symbolicSelection(request.kind, considered)
  }

  if (request.kind === "triangle") {
    const explicit = request.constraints?.triangle
    if (explicit) {
      const validated = validateTriangleWitness(explicit)
      if (!validated.ok) return rejectedSelection("triangle", "degenerate_witness", `显式给出的三角形退化：${validated.reason}`, considered)
      considered.push("explicit: 沿用题目给出的三角形。")
      return {
        status: "witness",
        value: { kind: "triangle", a: { ...explicit.a }, b: { ...explicit.b }, c: { ...explicit.c } },
        assumption: {
          id: "witness:triangle",
          text: `三角形按你给出的三个顶点取 A${pointText(explicit.a)}、B${pointText(explicit.b)}、C${pointText(explicit.c)}。`,
          kind: "witness",
          value: explicit,
          overridable: true,
          path: "witness.triangle"
        },
        considered,
        diagnostics: []
      }
    }
    const picked = firstAcceptableTriangle(witnessTriangleCandidates())
    if (!picked) return rejectedSelection("triangle", "no_acceptable_witness", "找不到既非退化又非特殊的三角形特值。", considered)
    const text = `题目没有给定三角形，取非特殊的小整数三角形 A${pointText(picked.triangle.a)}、B${pointText(picked.triangle.b)}、C${pointText(picked.triangle.c)}。`
    return {
      status: "witness",
      value: { kind: "triangle", ...picked.triangle },
      assumption: { id: "witness:triangle", text, kind: "witness", value: picked.triangle, overridable: true, path: "witness.triangle" },
      considered: picked.considered,
      diagnostics: []
    }
  }

  if (request.kind === "slope") {
    const value = request.constraints?.slope ?? DEFAULT_SLOPE
    if (!Number.isFinite(value)) return rejectedSelection("slope", "degenerate_witness", "斜率必须是有限数。", considered)
    considered.push("explicit: 题目给了斜率。" )
    return {
      status: "witness",
      value: { kind: "slope", value },
      assumption: { id: "witness:slope", text: value === 0 ? "斜率未给定，取水平（k = 0）。" : `斜率按你给出的 ${value} 取。`, kind: "witness", value, overridable: true, path: "witness.slope" },
      considered,
      diagnostics: []
    }
  }

  if (request.kind === "prism") {
    const explicit = request.constraints?.prism
    const basePolygon = (explicit?.basePolygon ?? defaultPrismBasePolygon(DEFAULT_PRISM_SPAN)).map((point) => ({ ...point }))
    const vector = { ...(explicit?.vector ?? request.constraints?.vector ?? defaultPrismVector(DEFAULT_PRISM_HEIGHT)) }
    const validated = validatePrismWitness(basePolygon, vector)
    if (!validated.ok) return rejectedSelection("prism", "degenerate_witness", `棱柱候选退化：${validated.reason}`, considered)
    considered.push("accepted: 底面边长 4、高 3 的棱柱特值（规格 §6.3）。")
    return {
      status: "witness",
      value: { kind: "prism", basePolygon, vector },
      assumption: {
        id: "witness:prism",
        text: `立体尺寸未指定，取底面边长 ${DEFAULT_PRISM_SPAN}、高 ${DEFAULT_PRISM_HEIGHT}。`,
        kind: "witness",
        value: { basePolygon, vector },
        overridable: true,
        path: "witness.prism"
      },
      considered,
      diagnostics: []
    }
  }

  const parameter = request.constraints?.parameter ?? DEFAULT_DYNAMIC_POINT_PARAMETER
  if (!Number.isFinite(parameter)) return rejectedSelection("moving_point", "degenerate_witness", "动点参数必须是有限数。", considered)
  considered.push("accepted: 普通动点取 t = 0.4（规格 §6.3）。")
  return {
    status: "witness",
    value: { kind: "moving_point", parameter },
    assumption: {
      id: "witness:moving_point",
      text: `动点位置未指定，取参数 ${DEFAULT_DYNAMIC_POINT_PARAMETER}。`,
      kind: "witness",
      value: parameter,
      overridable: true,
      path: "witness.moving_point"
    },
    considered,
    diagnostics: []
  }
}
