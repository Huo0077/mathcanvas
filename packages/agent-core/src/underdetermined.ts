import { buildFromPoints, createBuilderContext, triangleCenter2, validatePrismInput, type Vector3 } from "@draw/geometry-kernel"

import type { PlanDiagnostic, StructuredAssumption } from "./contracts"
import { DEFAULT_DYNAMIC_POINT_PARAMETER, DEFAULT_PRISM_HEIGHT, DEFAULT_PRISM_SPAN, DEFAULT_SLOPE, WITNESS_TRIANGLE, defaultPrismBasePolygon, defaultPrismVector } from "./localPlanDefaults"
import { verifyRelations, type Relation, type RelationLookup } from "./relations"

/**
 * **欠定题目的特值选择**（Agent DSL 切片 Task 3；规格 §6.3）。
 *
 * ```
 * 欠定选择优先级：满足显式约束、保持非退化、避免特殊对称、使用小整数、最小化复杂度。
 * 若任务要求普遍证明或动态保持关系，必须保留符号参数；仅画示意图可选合条件的一例。
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

export type WitnessKind = "triangle" | "slope" | "prism" | "moving_point" | "polyhedron"

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

/**
 * **任意多面体的见证**（设计 2026-10-03 §5.4）。
 *
 * 这是"只有关系、没有数值"的立体题面（四棱锥 P-ABCD 那类）唯一可能的出口：
 * 不规则形状在动作层只能走 `solid.create_polyhedron`，而它的 `vertices` / `faces`
 * 是必填、零默认 —— 一组坐标必须由**模型算出来**，系统的职责是逐条核验。
 *
 * `names` 与 `vertices` 按下标对应，关系表用**下标名**（`v0`、`v1`…）引用顶点
 * （设计 §2 决定 7：第一批关系目标只支持顶点）。
 *
 * **本批没有产品调用点**（执行前的范围裁定，2026-10-03）：`selectWitness` 的非测试调用点
 * 只有 `parameterAudit.ts`，而它只请求 triangle / prism。所以这个族现在的价值是
 * "为第二批（平面）与将来的'系统自己挑特值'留接口"，**不是本批验收的依据** ——
 * 解掉用户报障的是 `planCompiler` 里的关系核验。不要把它读成"它修好了报障"。
 */
export interface PolyhedronWitness {
  vertices: Vector3[]
  /** 顶点名，与题面一致；关系表按下标约定引用（`v0`、`v1`…）。 */
  names: string[]
  /** 面环，元素是 `vertices` 的下标。 */
  faces: number[][]
}

export type WitnessValue =
  | ({ kind: "triangle" } & TriangleWitness)
  | { kind: "slope"; value: number }
  | ({ kind: "prism" } & PrismWitness)
  | { kind: "moving_point"; parameter: number }
  | ({ kind: "polyhedron" } & PolyhedronWitness)

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
  /** 模型给出的多面体候选（多面体族用）。缺省时没有候选可挑，如实返回 rejected。 */
  candidates?: readonly PolyhedronWitness[]
  /** 题目显式给出的关系。**判据在 `relations.ts`，这里只调它。** */
  relations?: readonly Relation[]
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
  // “任意”限定的是图形族，不限定用户此刻要交付的东西。
  // 静态画图允许选一张满足题设的示例；普遍证明与持续移动仍要保留参数。
  if (/(?:求证|证明|恒定|定值|不变|全都成立|invariant|for all|constant)/i.test(lowered)) return true
  if (/(?:任意.*(?:移动|运动|变化)|任意动点|随.*变化)/.test(lowered)) return true
  if (/(?:画|作|绘|示意图)/.test(lowered)) return false
  return SYMBOLIC_KEYWORDS.some((keyword) => lowered.includes(keyword.toLowerCase()))
}

/** 每个族在"必须保留符号"时留下的符号名。 */
const SYMBOLS_BY_KIND: Record<WitnessKind, readonly string[]> = {
  triangle: ["A", "B", "C"],
  slope: ["k"],
  prism: ["a", "h"],
  moving_point: ["t"],
  /**
   * 多面体的符号是**边长 / 高度**这一类自由量，不是某个具体顶点 —— 题面说"任意四棱锥"时，
   * 保留的是"形状自由"这件事本身。漏掉这一项会让 `symbols.join` 直接抛 TypeError
   * （实测踩到），而 `WitnessKind` 加了新成员、这张表却没跟上，是**编译期查不出来**的：
   * `Record<WitnessKind, …>` 本该拦住，但它被写在 `WitnessKind` 扩过之后才补——
   * 真正兜住它的是那条"任意图形必须返回 symbolic"的用例。
   */
  polyhedron: ["边长", "高"]
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

  /**
   * **多面体**（设计 2026-10-03 §5.4）：候选由模型给出，这里只做**筛选**。
   *
   * 与其它族的关键区别：其它族的候选是**常量表**（`witnessTriangleCandidates()`），
   * 而"四棱锥满足 PA ⊥ 底面"这组坐标不可能预置 —— 它取决于题面。所以候选来自 `request`。
   *
   * 筛选顺序就是规格 §6.3 的优先级，两步都不可省：
   * ① **先验题目显式关系**（优先级第一条）—— 不满足的候选跳过，理由记进 `considered`；
   * ② **再验几何合法性** —— 判据来自内核 `buildFromPoints`（共面 / 自交 / 零体积 / 绕向 /
   *    连通性），与真正落盘时用的是同一个构造器，所以不会出现"这里说合法、内核说不行"。
   *
   * **符号优先已经在函数开头处理掉了**（`isInvariantRequest`）：任务要求普遍证明或动态参数时
   * 根本走不到这里。这个顺序不许改动。
   */
  if (request.kind === "polyhedron") {
    const declared = request.relations ?? []
    const candidates = request.candidates ?? []
    const accepted: { witness: PolyhedronWitness; index: number; readability: number }[] = []
    for (const [index, candidate] of candidates.entries()) {
      if (candidate.names.length !== candidate.vertices.length || new Set(candidate.names).size !== candidate.names.length) {
        considered.push(`names: 候选 ${index} 顶点名与坐标没有一一对应，不能核验。`)
        continue
      }
      const byName = new Map(candidate.names.map((name, position) => [name, candidate.vertices[position]]))
      const lookup: RelationLookup = (target) => byName.get(target.vertex) ?? null
      const check = verifyRelations(declared, lookup)
      if (!check.ok) {
        considered.push(`relations: 候选 ${index} 未满足 ${check.failures.map((failure) => failure.id).join("、")} —— ${check.failures[0].detail}`)
        continue
      }

      // The same kernel constructor used for the final solid rejects degenerate topology.
      const built = buildFromPoints({ vertices: candidate.vertices, faces: candidate.faces }, createBuilderContext())
      if (built.diagnostics.length > 0) {
        considered.push(`degenerate: 候选 ${index} 几何不合法 —— ${built.diagnostics.map((entry) => entry.message).join("；")}`)
        continue
      }

      // A preference, never a constraint: only candidates that passed every relation
      // and topology check are ranked. Translation and rotation do not affect the score.
      const spans = (["x", "y", "z"] as const).map((axis) => {
        const values = candidate.vertices.map((vertex) => vertex[axis])
        return Math.max(...values) - Math.min(...values)
      })
      const readability = Math.min(...spans) / Math.max(...spans)
      accepted.push({ witness: candidate, index, readability })
      considered.push(`accepted: 候选 ${index} 关系逐条成立、几何合法。`)
    }

    if (accepted.length === 0) return rejectedSelection("polyhedron", "no_acceptable_witness", "没有候选能同时满足题面关系与几何合法性。", considered)
    // Stable tie-breaking: an equally readable candidate keeps its input order.
    const chosen = accepted.reduce((best, current) => current.readability > best.readability ? current : best)
    const candidate = chosen.witness
    considered.push(`chosen: 候选 ${chosen.index} 在合格图中比例更适合观察。`)
    const described = candidate.names
      .map((name, position) => `${name}(${candidate.vertices[position].x}, ${candidate.vertices[position].y}, ${candidate.vertices[position].z})`)
      .join("、")
    return {
      status: "witness",
      value: { kind: "polyhedron", ...candidate },
      assumption: {
        id: "witness:polyhedron",
        text: `题目没有给定具体尺寸，以下为系统选取的一组示例值（满足题面全部关系，可在属性栏修改）：${described}。`,
        kind: "witness",
        value: candidate,
        overridable: true,
        path: "witness.polyhedron"
      },
      considered,
      diagnostics: []
    }
  }
  const parameter = request.constraints?.parameter ?? DEFAULT_DYNAMIC_POINT_PARAMETER
  if (!Number.isFinite(parameter)) return rejectedSelection("moving_point", "degenerate_witness", "动点参数必须是有限数。", considered)
  considered.push(`accepted: 普通动点取 t = ${parameter}（规格 §6.3 的默认是 ${DEFAULT_DYNAMIC_POINT_PARAMETER}）。`)
  return {
    status: "witness",
    value: { kind: "moving_point", parameter },
    assumption: {
      id: "witness:moving_point",
      /**
       * 文案按**实际取值**写（Fix round 1 / M2）：写死 0.4 时，`constraints.parameter` 给了别的值
       * 会让假设列表里的话与文档里的数字对不上。
       */
      text: request.constraints?.parameter === undefined
        ? `动点位置未指定，取参数 ${DEFAULT_DYNAMIC_POINT_PARAMETER}。`
        : `动点位置按你给出的参数 ${parameter} 取。`,
      kind: "witness",
      value: parameter,
      overridable: true,
      path: "witness.moving_point"
    },
    considered,
    diagnostics: []
  }
}
