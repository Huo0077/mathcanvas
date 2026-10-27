/**
 * **独立判据**（T01/T02，2026-10-27）：不经过产品解析器与产品核验器，直接从**候选文档**的
 * 点坐标回代题单里写死的期望。
 *
 * 为什么必须独立：
 * - 产品自己的 `diagramVerification` 是"用同一份解析结果证明自己没漏读"；
 * - 题单的 oracle 由题面独立推导（例如矩形折后 `|B′D| = 2√85/5`），只读候选几何的点名与坐标；
 * - 两边都过才算一条题成立。
 *
 * 这一层刻意只依赖"点名字 + 坐标"这一种最小事实（`point3` 图元的 `label` / `position`），
 * 不 import 任何 agent-core 的解析/核验模块 —— 否则"独立"就名不副实。
 */

export interface OraclePoint {
  label: string
  position: { x: number; y: number; z: number }
}

export type OracleFact =
  | { kind: "distance"; a: string; b: string; value: number }
  /** `(a − b) · (d − c)`：与产品无关的点积口径。 */
  | { kind: "dot"; a: string; b: string; c: string; d: string; value: number }
  | { kind: "point-coordinate"; name: string; x: number; y: number; z: number }
  | { kind: "planes-perpendicular"; first: [string, string, string]; second: [string, string, string] }
  | { kind: "point-count"; minimum: number }
  /** 候选文档里某类图元至少有几个（`type` 省略时数全部）。 */
  | { kind: "primitive-count"; type?: string; minimum: number }
  /**
   * **两段长度之比** `|ab| / |cd|`（2026-10-27）：题面里"两条边的长度比"那一族（`AB=2BC`、
   * `AB=2BC=4`）与"定比分点"在形状上分不开，产品侧改成读读取器写下的来源；
   * oracle 侧就**只量比值** —— 两边各量各的，谁都不看对方的解析结果。
   */
  | { kind: "segment-ratio"; a: string; b: string; c: string; d: string; value: number }
  /**
   * **两条向量的夹角（度）** `∠((b−a), (d−c))`（2026-10-27）。
   *
   * 翻折题里最有用的不变量是"折片与折痕的夹角折叠前后不变"（`∠(AB′, AC) = ∠BAC`）：
   * 它只依赖刚体运动，不依赖折起多少度，所以能独立地把"折片没被拉长/压扁"钉住。
   */
  | { kind: "angle"; a: string; b: string; c: string; d: string; value: number }

export type Oracle = { facts: readonly OracleFact[] }

export interface OracleFactResult {
  fact: OracleFact
  status: "passed" | "failed"
  detail: string
}

export interface OracleResult {
  status: "passed" | "failed" | "not_applicable"
  facts: OracleFactResult[]
}

const DISTANCE_TOLERANCE = 1e-6

function pointsOf(candidate: unknown): Map<string, OraclePoint["position"]> {
  const points = new Map<string, OraclePoint["position"]>()
  const primitives = (candidate as { primitives?: readonly unknown[] } | null | undefined)?.primitives
  if (!Array.isArray(primitives)) return points
  for (const primitive of primitives) {
    const record = primitive as { type?: unknown; label?: unknown; position?: unknown }
    if (record.type !== "point3" || typeof record.label !== "string" || record.label.length === 0) continue
    const position = record.position as { x?: unknown; y?: unknown; z?: unknown } | undefined
    if (position === undefined || ![position.x, position.y, position.z].every((value) => typeof value === "number" && Number.isFinite(value))) continue
    points.set(record.label, { x: position.x as number, y: position.y as number, z: position.z as number })
  }
  return points
}

type Vec = { x: number; y: number; z: number }

function sub(left: Vec, right: Vec): Vec {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z }
}

function dot(left: Vec, right: Vec): number {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

function norm(vector: Vec): number {
  return Math.sqrt(dot(vector, vector))
}

function cross(left: Vec, right: Vec): Vec {
  return { x: left.y * right.z - left.z * right.y, y: left.z * right.x - left.x * right.z, z: left.x * right.y - left.y * right.x }
}

function close(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= DISTANCE_TOLERANCE * Math.max(1, Math.abs(actual), Math.abs(expected))
}

/** 两条向量的夹角（度）。任一向量退化时返回 `null`（不猜一个角度出来）。 */
function angleDegrees(left: Vec, right: Vec): number | null {
  const scale = norm(left) * norm(right)
  if (!(scale > 1e-12)) return null
  const cosine = Math.max(-1, Math.min(1, dot(left, right) / scale))
  return (Math.acos(cosine) * 180) / Math.PI
}

/**
 * 把题单的 oracle 逐条回代到候选文档。
 *
 * `candidate` 缺失或读不出图元时返回 `not_applicable`（**不算通过**，也不算题面失败）。
 */
export function evaluateOracle(candidate: unknown, oracle: Oracle): OracleResult {
  const primitives = (candidate as { primitives?: readonly unknown[] } | null | undefined)?.primitives
  if (!Array.isArray(primitives)) return { status: "not_applicable", facts: [] }
  const points = pointsOf(candidate)
  const results: OracleFactResult[] = []

  for (const fact of oracle.facts) {
    if (fact.kind === "primitive-count") {
      const matched = primitives.filter((primitive) => fact.type === undefined || (primitive as { type?: unknown }).type === fact.type)
      // 不指定 `type` 时把**实际都有哪些类型**也说出来：题单写错类型名时，这条 detail 是唯一的线索。
      const byType = new Map<string, number>()
      for (const primitive of primitives) {
        const type = (primitive as { type?: unknown }).type
        const key = typeof type === "string" ? type : "(无 type)"
        byType.set(key, (byType.get(key) ?? 0) + 1)
      }
      const inventory = [...byType.entries()].map(([type, count]) => `${type}×${count}`).join("、")
      results.push({
        fact,
        status: matched.length >= fact.minimum ? "passed" : "failed",
        detail: `候选文档里${fact.type === undefined ? "全部图元" : ` ${fact.type} 图元`} ${matched.length} 个，至少要求 ${fact.minimum} 个${fact.type === undefined && inventory.length > 0 ? `（实际类型：${inventory}）` : ""}。`
      })
      continue
    }
    if (fact.kind === "point-count") {
      const actual = points.size
      results.push({
        fact,
        status: actual >= fact.minimum ? "passed" : "failed",
        detail: `候选文档里带名字的点 ${actual} 个，至少要求 ${fact.minimum} 个。`
      })
      continue
    }
    if (fact.kind === "planes-perpendicular") {
      const named = [...fact.first, ...fact.second].filter((name) => points.has(name))
      if (named.length !== 6) {
        results.push({ fact, status: "failed", detail: `平面垂直判据缺点名：${[...new Set([...fact.first, ...fact.second].filter((name) => !points.has(name)))].join("、")}。` })
        continue
      }
      const [a1, b1, c1] = fact.first.map((name) => points.get(name)!)
      const [a2, b2, c2] = fact.second.map((name) => points.get(name)!) as [Vec, Vec, Vec]
      const firstNormal = cross(sub(b1!, a1!), sub(c1!, a1!))
      const secondNormal = cross(sub(b2, a2), sub(c2, a2))
      const scale = norm(firstNormal) * norm(secondNormal)
      const cosine = scale > 1e-12 ? dot(firstNormal, secondNormal) / scale : Number.POSITIVE_INFINITY
      results.push({
        fact,
        status: Math.abs(cosine) <= 1e-6 ? "passed" : "failed",
        detail: `两平面法向点积的归一化绝对值=${cosine}（垂直要求 0）。`
      })
      continue
    }
    const needed = fact.kind === "distance" ? [fact.a, fact.b] : fact.kind === "dot" || fact.kind === "segment-ratio" || fact.kind === "angle" ? [fact.a, fact.b, fact.c, fact.d] : [fact.name]
    const missing = needed.filter((name) => !points.has(name))
    if (missing.length > 0) {
      results.push({ fact, status: "failed", detail: `缺点名：${[...new Set(missing)].join("、")}。` })
      continue
    }
    if (fact.kind === "distance") {
      const actual = norm(sub(points.get(fact.a)!, points.get(fact.b)!))
      results.push({ fact, status: close(actual, fact.value) ? "passed" : "failed", detail: `|${fact.a}${fact.b}|=${actual}，独立 oracle=${fact.value}。` })
      continue
    }
    if (fact.kind === "segment-ratio") {
      const numerator = norm(sub(points.get(fact.a)!, points.get(fact.b)!))
      const denominator = norm(sub(points.get(fact.d)!, points.get(fact.c)!))
      const actual = denominator > 1e-12 ? numerator / denominator : Number.POSITIVE_INFINITY
      results.push({
        fact,
        status: close(actual, fact.value) ? "passed" : "failed",
        detail: `|${fact.a}${fact.b}|/|${fact.c}${fact.d}|=${actual}，独立 oracle=${fact.value}。`
      })
      continue
    }
    if (fact.kind === "angle") {
      const actual = angleDegrees(sub(points.get(fact.b)!, points.get(fact.a)!), sub(points.get(fact.d)!, points.get(fact.c)!))
      results.push({
        fact,
        status: actual !== null && close(actual, fact.value) ? "passed" : "failed",
        detail: actual === null
          ? `∠(${fact.a}${fact.b}, ${fact.c}${fact.d}) 有一条向量退化了（量不出角度）。`
          : `∠(${fact.a}${fact.b}, ${fact.c}${fact.d})=${actual}°，独立 oracle=${fact.value}°。`
      })
      continue
    }
    if (fact.kind === "dot") {
      const actual = dot(sub(points.get(fact.a)!, points.get(fact.b)!), sub(points.get(fact.d)!, points.get(fact.c)!))
      results.push({ fact, status: close(actual, fact.value) ? "passed" : "failed", detail: `(${fact.a}−${fact.b})·(${fact.d}−${fact.c})=${actual}，独立 oracle=${fact.value}。` })
      continue
    }
    const point = points.get(fact.name)!
    const ok = close(point.x, fact.x) && close(point.y, fact.y) && close(point.z, fact.z)
    results.push({ fact, status: ok ? "passed" : "failed", detail: `${fact.name}=(${point.x}, ${point.y}, ${point.z})，独立 oracle=(${fact.x}, ${fact.y}, ${fact.z})。` })
  }

  return { status: results.every((entry) => entry.status === "passed") ? "passed" : "failed", facts: results }
}
