/**
 * **目标层：题设核验通过之后，单独判断"所求结论"**（T7，2026-11-05 四题修复）。
 *
 * 见 [修复设计](../../../../docs/superpowers/specs/2026-11-05-solid-geometry-four-cases-design.md) §4.2 第 7 条。
 *
 * ## 为什么必须与题设核验分开
 *
 * Case 1 的 `AE⊥平面PBC` 与 Case 2 的 `A₁C∥平面B₁DE` 都是**假**的。把目标混进题设去核，
 * 就会得出"这道题画错了"；而正确的读法是：**题设全部成立、图形可以留着**，
 * 只是这条**待证结论**不成立。所以本模块：
 *
 * - 只在题设已经通过独立核验的候选上运行；
 * - 每个目标给出**自己的**证据状态与量值，不写回 givens；
 * - 数值（1/√2、0、√3、acos(1/√3)）用 T7 的坐标量测，**不硬编码题号**。
 *
 * ## 证据口径
 *
 * `holds` / `disproved` / `measured` 都是"在这个实例上量出来的"——不是"对所有情形成立"。
 * 文案里必须写清这一点；`formally_proved` 只有走证明产物那条路才允许出现（本模块不产出）。
 */

import { dihedralCosine, linePlaneSine, planeNormalOf, pointPlaneDistance, type Vector3 } from "@draw/geometry-kernel"

import { parseObligationWithLegacy } from "./obligationIR"

export type SolidGoalKind =
  | "line-plane-perpendicular"
  | "line-plane-parallel"
  | "segment-perpendicular"
  | "line-plane-angle"
  | "dihedral"
  | "point-plane-distance"

export interface SolidGoalFinding {
  kind: SolidGoalKind
  /** 题面原话（尽量整句）。 */
  sourceText: string
  status: "holds" | "disproved" | "measured" | "unsupported" | "unverified"
  /** 量出来的数（角度 / 距离 / 余弦）；`null` = 没量。 */
  measured: number | null
  /** 非零就说明"差多少"。 */
  residual: number | null
  detail: string
}

const POINT = "[A-Z](?:[′]|[₁₂₃₄₅₆])?"
const ANGLE_TOLERANCE = 1e-6

/** 题面里的**数值目标**（角度 / 距离）——几何命题由既有 obligation 读取器给。 */
interface NumericGoal {
  kind: "line-plane-angle" | "dihedral" | "point-plane-distance"
  sourceText: string
  /** 直线方向的两端点 / 平面三点 / 二面角的四个点 / 点到平面。 */
  targets: string[]
}

function splitNames(value: string): string[] {
  return value.match(new RegExp(POINT, "g")) ?? []
}

/** 读"求…"里的数值目标。**只认这四种写法**，认不出就不产目标（不猜）。 */
export function readNumericGoals(prompt: string): NumericGoal[] {
  const goals: NumericGoal[] = []
  const lineAngle = new RegExp(`直线\\s*(${POINT})(${POINT})\\s*与平面\\s*((?:${POINT}){3,4})\\s*所成角`, "g")
  for (const match of prompt.matchAll(lineAngle)) {
    const plane = splitNames(match[3]!)
    goals.push({ kind: "line-plane-angle", sourceText: match[0], targets: [match[1]!, match[2]!, ...plane] })
  }
  const dihedral = new RegExp(`二面角\\s*(${POINT})\\s*[-−—]\\s*(${POINT})(${POINT})\\s*[-−—]\\s*(${POINT})`, "g")
  for (const match of prompt.matchAll(dihedral)) {
    goals.push({ kind: "dihedral", sourceText: match[0], targets: [match[1]!, match[2]!, match[3]!, match[4]!] })
  }
  const distance = new RegExp(`点\\s*(${POINT})\\s*到平面\\s*((?:${POINT}){3,4})\\s*的距离`, "g")
  for (const match of prompt.matchAll(distance)) {
    goals.push({ kind: "point-plane-distance", sourceText: match[0], targets: [match[1]!, ...splitNames(match[2]!)] })
  }
  return goals
}

/** 几何命题目标（线段/平面）：来自既有 obligation 读取器的 `goal` 角色。 */
interface PropositionGoal {
  kind: "line-plane-perpendicular" | "line-plane-parallel" | "segment-perpendicular"
  sourceText: string
  /** 直线两端 / 另一条线两端，或直线两端 / 平面三点。 */
  targets: string[]
}

export function readPropositionGoals(prompt: string): PropositionGoal[] {
  const goals = parseObligationWithLegacy(prompt).ir.obligations.filter((obligation) => obligation.role === "goal")
  const result: PropositionGoal[] = []
  for (const goal of goals) {
    if (goal.kind === "perpendicular" && goal.targets.length === 5) {
      result.push({ kind: "line-plane-perpendicular", sourceText: goal.sourceText, targets: [...goal.targets] })
      continue
    }
    if (goal.kind === "parallel" && goal.targets.length === 5) {
      result.push({ kind: "line-plane-parallel", sourceText: goal.sourceText, targets: [...goal.targets] })
      continue
    }
    if (goal.kind === "perpendicular" && goal.targets.length === 4) {
      result.push({ kind: "segment-perpendicular", sourceText: goal.sourceText, targets: [...goal.targets] })
    }
  }
  return result
}

const at = (points: ReadonlyMap<string, Vector3>, name: string): Vector3 | null => points.get(name) ?? null
const subtract = (left: Vector3, right: Vector3): Vector3 => ({ x: left.x - right.x, y: left.y - right.y, z: left.z - right.z })
const dot = (left: Vector3, right: Vector3): number => left.x * right.x + left.y * right.y + left.z * right.z
const norm = (value: Vector3): number => Math.hypot(value.x, value.y, value.z)

function normalOf(points: ReadonlyMap<string, Vector3>, names: readonly string[]): { status: "ok"; normal: Vector3 } | { status: "unverified"; detail: string } {
  const coordinates = names.map((name) => at(points, name))
  if (coordinates.some((point) => point === null)) return { status: "unverified", detail: `平面 ${names.join("")} 里有点不在图上。` }
  const normal = planeNormalOf(coordinates as Vector3[])
  if (normal.status !== "ok") return { status: "unverified", detail: normal.message }
  return { status: "ok", normal: normal.normal }
}

/**
 * 对**已经通过题设核验**的点表求目标。缺点的目标给 `unverified`（不是"不成立"）。
 */
export function evaluateSolidGoals(prompt: string, points: ReadonlyMap<string, Vector3>): SolidGoalFinding[] {
  const findings: SolidGoalFinding[] = []
  for (const goal of readPropositionGoals(prompt)) {
    if (goal.kind === "segment-perpendicular") {
      const [a, b, c, d] = goal.targets
      const first = at(points, a!)
      const second = at(points, b!)
      const third = at(points, c!)
      const fourth = at(points, d!)
      if (first === null || second === null || third === null || fourth === null) {
        findings.push({ kind: goal.kind, sourceText: goal.sourceText, status: "unverified", measured: null, residual: null, detail: "目标里点名的点不在图上。" })
        continue
      }
      const left = subtract(second, first)
      const right = subtract(fourth, third)
      const scale = Math.max(1, norm(left) * norm(right))
      const residual = Math.abs(dot(left, right)) / scale
      findings.push({
        kind: goal.kind,
        sourceText: goal.sourceText,
        status: residual <= ANGLE_TOLERANCE ? "holds" : "disproved",
        measured: dot(left, right) / scale,
        residual,
        detail: `${a}${b}·${c}${d} = ${dot(left, right).toPrecision(8)}（|${a}${b}|=${norm(left).toPrecision(6)}、|${c}${d}|=${norm(right).toPrecision(6)}），残差 ${residual.toExponential(3)}。`
      })
      continue
    }
    const lineFirst = at(points, goal.targets[0]!)
    const lineSecond = at(points, goal.targets[1]!)
    const plane = normalOf(points, goal.targets.slice(2))
    if (lineFirst === null || lineSecond === null || plane.status !== "ok") {
      findings.push({ kind: goal.kind, sourceText: goal.sourceText, status: "unverified", measured: null, residual: null, detail: plane.status === "unverified" ? plane.detail : "目标里点名的点不在图上。" })
      continue
    }
    const direction = subtract(lineSecond, lineFirst)
    const sine = linePlaneSine(direction, plane.normal)
    if (sine.status !== "ok") {
      findings.push({ kind: goal.kind, sourceText: goal.sourceText, status: "unverified", measured: null, residual: null, detail: sine.message })
      continue
    }
    if (goal.kind === "line-plane-perpendicular") {
      /** 线面垂直 ⇔ 方向与法向**平行** ⇔ `sinθ = 1`。 */
      const residual = 1 - sine.value
      findings.push({
        kind: goal.kind,
        sourceText: goal.sourceText,
        status: residual <= ANGLE_TOLERANCE ? "holds" : "disproved",
        measured: sine.value,
        residual,
        detail: `线面角的正弦 = ${sine.value.toPrecision(8)}（垂直要求 1），残差 ${residual.toExponential(3)}。`
      })
      continue
    }
    /** 线面平行 ⇔ 方向与法向**垂直** ⇔ `sinθ = 0`；点都在平面内则是"线在面内"，单独说。 */
    const pointDistance = pointPlaneDistance(lineFirst, at(points, goal.targets[2]!)!, plane.normal)
    const inPlane = pointDistance.status === "ok" && pointDistance.value <= ANGLE_TOLERANCE
    findings.push({
      kind: goal.kind,
      sourceText: goal.sourceText,
      status: inPlane ? "unverified" : sine.value <= ANGLE_TOLERANCE ? "holds" : "disproved",
      measured: sine.value,
      residual: sine.value,
      detail: inPlane
        ? `直线的端点在平面上（线在面内）：这不是"线面平行"，本层不把它算成立。`
        : `方向与法向的夹角余弦 = ${sine.value.toPrecision(8)}（平行要求 0），残差 ${sine.value.toExponential(3)}。`
    })
  }

  for (const goal of readNumericGoals(prompt)) {
    if (goal.kind === "line-plane-angle") {
      const first = at(points, goal.targets[0]!)
      const second = at(points, goal.targets[1]!)
      const plane = normalOf(points, goal.targets.slice(2))
      if (first === null || second === null || plane.status !== "ok") {
        findings.push({ kind: goal.kind, sourceText: goal.sourceText, status: "unverified", measured: null, residual: null, detail: plane.status === "unverified" ? plane.detail : "目标里点名的点不在图上。" })
        continue
      }
      const sine = linePlaneSine(subtract(second, first), plane.normal)
      findings.push({
        kind: goal.kind,
        sourceText: goal.sourceText,
        status: sine.status === "ok" ? "measured" : "unverified",
        measured: sine.status === "ok" ? sine.value : null,
        residual: null,
        detail: sine.status === "ok" ? `sin∠(${goal.targets[0]}${goal.targets[1]}, 平面${goal.targets.slice(2).join("")}) = ${sine.value.toPrecision(12)}。` : sine.message
      })
      continue
    }
    if (goal.kind === "dihedral") {
      const [a, b, c, d] = goal.targets
      const hingeStart = at(points, b!)
      const hingeEnd = at(points, c!)
      const firstPoint = at(points, a!)
      const secondPoint = at(points, d!)
      if (hingeStart === null || hingeEnd === null || firstPoint === null || secondPoint === null) {
        findings.push({ kind: goal.kind, sourceText: goal.sourceText, status: "unverified", measured: null, residual: null, detail: "二面角的四个点名不全在图上。" })
        continue
      }
      const cosine = dihedralCosine({ hingeStart, hingeEnd, firstPoint, secondPoint })
      findings.push({
        kind: goal.kind,
        sourceText: goal.sourceText,
        status: cosine.status === "ok" ? "measured" : "unverified",
        measured: cosine.status === "ok" ? cosine.value : null,
        residual: null,
        detail: cosine.status === "ok" ? `cos∠(${a}-${b}${c}-${d}) = ${cosine.value.toPrecision(12)}（${((Math.acos(Math.min(1, Math.max(-1, cosine.value))) * 180) / Math.PI).toFixed(6)}°）。` : cosine.message
      })
      continue
    }
    const point = at(points, goal.targets[0]!)
    const plane = normalOf(points, goal.targets.slice(1))
    if (point === null || plane.status !== "ok") {
      findings.push({ kind: goal.kind, sourceText: goal.sourceText, status: "unverified", measured: null, residual: null, detail: plane.status === "unverified" ? plane.detail : "目标里点名的点不在图上。" })
      continue
    }
    const distance = pointPlaneDistance(point, at(points, goal.targets[1]!)!, plane.normal)
    findings.push({
      kind: goal.kind,
      sourceText: goal.sourceText,
      status: distance.status === "ok" ? "measured" : "unverified",
      measured: distance.status === "ok" ? distance.value : null,
      residual: null,
      detail: distance.status === "ok" ? `d(${goal.targets[0]}, 平面${goal.targets.slice(1).join("")}) = ${distance.value.toPrecision(12)}。` : distance.message
    })
  }
  return findings
}

/**
 * 目标结果 → 用户可见的文案。
 *
 * **三条纪律**写在文案里：
 * - "题设已通过核验"与"这条结论不成立"可以并存；
 * - 坐标量测**不是**形式化证明（不写"整题已证明"）；
 * - 不成立的结论给**非零残差**与量值，不说"可能"。
 */
export function formatSolidGoalAnswer(findings: readonly SolidGoalFinding[]): string | null {
  if (findings.length === 0) return null
  const lines = findings.map((finding, index) => {
    const label = finding.sourceText.replace(/[；。\s]+$/u, "")
    if (finding.status === "holds") return `（${index + 1}）「${label}」在所构造的图形中**成立**（坐标核验；这是实例证据，不等于形式化证明）：${finding.detail}`
    if (finding.status === "disproved") return `（${index + 1}）「${label}」**不成立**：${finding.detail}。题设本身仍然通过核验 —— 图形可以保留，但这条结论不成立。`
    if (finding.status === "measured") return `（${index + 1}）「${label}」= ${finding.measured === null ? "（未量出）" : finding.measured.toPrecision(12)}（坐标量测；实例值，不是形式化证明）。`
    return `（${index + 1}）「${label}」尚未核验：${finding.detail}`
  })
  return ["目标结果（与题设核验分开）：", ...lines].join("\n")
}
