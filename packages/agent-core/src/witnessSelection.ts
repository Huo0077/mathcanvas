import { triangleCenter2, validatePrismInput, type Vector3 } from "@draw/geometry-kernel"

import type { PlanDiagnostic, StructuredAssumption } from "./contracts"
import { isInvariantRequest } from "./invariantRequest"
import { DEFAULT_DYNAMIC_POINT_PARAMETER, DEFAULT_PRISM_HEIGHT, DEFAULT_PRISM_SPAN, DEFAULT_SLOPE, WITNESS_TRIANGLE, defaultPrismBasePolygon, defaultPrismVector } from "./localPlanDefaults"
import type { Relation } from "./relations"
import type { PolyhedronWitness } from "./solver/solverContracts"

/**
 * **欠定题目的特值选择：不需要编译器的那几个族**（Agent DSL 切片 Task 3；规格 §6.3；
 * N2 子任务 2b 的复核裁决 R29-B）。
 *
 * ```text
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
 *
 * ## 为什么它是一个**叶子模块**（R29-B：断模块环）
 *
 * 这几族的选择只依赖常量表与内核的纯函数，**与编译器无关**；而 `polyhedron` 族要走
 * "候选坐标 → 既有编译路径物化 → 统一核验器"那条链，所以它留在
 * `underdetermined.ts` 的 facade 里。分开不是为了好看，而是因为 `parameterAudit.ts`
 * 要用选择器、`planCompiler.ts` 又要用 `parameterAudit` —— 只要 audit 能顺着选择器走到
 * `planCompiler`，模块图就成环（详见 `underdetermined.ts` 的文件头）。
 *
 * 分开之后，本模块**不 import 任何能到达 `planCompiler` 的东西**（只有纯类型 / 纯函数：
 * `contracts` 的类型、`invariantRequest`、`localPlanDefaults`、`relations` 的类型、
 * `solver/solverContracts` 的类型、以及内核），并且"调用方不会请求 polyhedron"这件事
 * **由类型保证**：`selectWitnessWithoutSearch` 只收 `Exclude<WitnessKind, "polyhedron">`。
 */

export type WitnessKind = "triangle" | "slope" | "prism" | "moving_point" | "polyhedron"

/** 不需要搜索器（因而不需要编译器）的那几族 —— 也就是这个模块负责的那几族。 */
export type WitnessKindWithoutSearch = Exclude<WitnessKind, "polyhedron">

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

/** 只收不需要搜索器的那几族：`polyhedron` 在**类型上**就进不来（见文件头）。 */
export type WitnessRequestWithoutSearch = WitnessRequest & { kind: WitnessKindWithoutSearch }

export type WitnessSelection =
  | { status: "witness"; value: WitnessValue; assumption: StructuredAssumption; considered: readonly string[]; diagnostics: PlanDiagnostic[] }
  | { status: "symbolic"; value: SymbolicWitness; assumption: StructuredAssumption; considered: readonly string[]; diagnostics: PlanDiagnostic[] }
  | { status: "rejected"; value: null; diagnostics: PlanDiagnostic[]; considered: readonly string[] }

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

/**
 * 符号结果。**这里导出**是为了让 `underdetermined.ts` 的 polyhedron 分支复用同一段文案与
 * 同一个假设形状（`witness:<kind>` 的 id / path 规则）—— 复制一份就等于给"任意题怎么答"
 * 造了第二个说法，而那两个说法迟早会分叉。
 */
export function symbolicSelection(kind: WitnessKind, considered: string[]): WitnessSelection {
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

/** 拒绝结果（同上：facade 的 polyhedron 分支复用它，诊断的形状只有一份）。 */
export function rejectedSelection(kind: WitnessKind, code: string, detail: string, considered: string[]): WitnessSelection {
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
 * **挑一个满足显式约束、非退化、非特殊、尽量小的特值**（规格 §6.3）—— 不需要搜索器的那几族。
 *
 * 顺序就是优先级：题目要求符号 → 返回符号；显式约束 → 原样用（退化则**拒绝**）；
 * 都没有 → 按候选顺序挑第一个可接受的。
 *
 * 与 `underdetermined.ts` 的 `selectWitness` 的分工：那边先处理 `polyhedron`（要搜索器），
 * 其余族**整段转调本题**。所以纯族的 `considered` / `assumption` / 诊断文案只有这一份。
 */
export function selectWitnessWithoutSearch(request: WitnessRequestWithoutSearch): WitnessSelection {
  const considered: string[] = []

  /**
   * **防御性拒绝**（R34 / M8）：类型上 `polyhedron` 进不来，但 JS 调用方或 `as` 断言绕得过类型。
   * 少了这一条，未类型化的 polyhedron 会一路掉到最下面的 moving_point 收尾分支，
   * 返回一个**种类都不对**的见证 —— 一个错的见证比一句拒绝糟得多。
   * 放在最前面：走到这里就已经说明调用方用错了入口（它该走 `underdetermined.ts` 的 `selectWitness`）。
   */
  if ((request.kind as WitnessKind) === "polyhedron") {
    return rejectedSelection(
      "polyhedron",
      "unsupported-witness-kind",
      "polyhedron 的选择要经过搜索器（因此经过编译器），不属于这个叶子模块；请走 underdetermined.ts 的 selectWitness。",
      considered
    )
  }

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
