import { POINT_NAME_SOURCE } from "@draw/geometry-kernel"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { uniqueFoldDisplayName } from "./namedFold"
import {
  buildRectangleFold,
  evaluateLength,
  evaluatePerpendicular,
  readRectangleFold,
  verifyRectangleFold,
  type RectangleFoldGeometry,
  type RectangleSpec
} from "./rectangleFold"

/**
 * **矩形对角线折叠题：从题面到计划 / 澄清**（A3 接线第一步，2026-10-26）。
 *
 * 这一层把 `readRectangleFold` 读到的题设变成**真实的动作计划**：
 *
 * 1. `solid.create_face` 建**不动的那一片**（折痕 + 另一个环上点）；
 * 2. `solid.fold` 建**折片**并把它折起来 —— 折前坐标**显式给出**（不依赖文档里先有那个点），
 *    折角来自题面明确的角或"两平面垂直"这条确定的 90°。
 *
 * ## 为什么计划里没有"折前 B"
 *
 * 折前 B 只在这道题的定义里存在一次：折片坐标由 `vertices` 给出，文档里不需要先建一个 B 点。
 * 折后点用 `uniqueFoldDisplayName` 生成一个**题面没有占用**的名字（用户案例是 `B′`）——
 * 内部状态仍由 `namedFold` 的 `B@s0`/`B@s1` 区分。
 *
 * ## 什么时候**不**出计划
 *
 * - 折角未知（既没给角、也没给"两平面垂直"）⇒ `clarification`，问折角；
 * - **目标被确定性否定**（用户案例 `BD⊥AC` 的残差是 12）⇒ `clarification`，
 *   把"该问不成立"和可给的距离一起说出来，**不产出可提交草稿**。
 *
 * ## 这一层**不**做什么
 *
 * 不把题设条件回代到候选文档 —— 折前条件（矩形、边长）要在**折前状态**核验，
 * 而现有的 `verifyDiagramObligations` 是"最终文档 + 单一状态"的。那一步（状态感知核验）
 * 尚未接线；`verifyRectangleFold` 已能对两份点表逐条核验，见 `rectangleFold.ts`。
 */

export interface PerpendicularGoalFinding {
  kind: "perpendicular"
  sourceText: string
  segments: [[string, string], [string, string]]
  holds: boolean
  residual: number
  detail: string
}

export interface LengthGoalFinding {
  kind: "length"
  sourceText: string
  segment: [string, string]
  value: number
  detail: string
}

export type RectangleFoldGoalFinding = PerpendicularGoalFinding | LengthGoalFinding

export type RectangleFoldSolution =
  | { status: "none" }
  | { status: "unsupported"; reason: string; sourceText?: string }
  | {
      status: "clarification"
      questions: string[]
      spec?: RectangleSpec
      geometry?: RectangleFoldGeometry
      findings: RectangleFoldGoalFinding[]
      reason: "needs_fold_angle" | "goal_does_not_hold"
    }
  | {
      status: "plan"
      plan: Extract<PlanEnvelope, { kind: "plan" }>
      spec: RectangleSpec
      geometry: RectangleFoldGeometry
      findings: RectangleFoldGoalFinding[]
    }

const P = POINT_NAME_SOURCE
const PERPENDICULAR_GOAL = new RegExp(`(${P})(${P})\\s*[⊥]\\s*(${P})(${P})`, "g")
const LENGTH_GOAL = new RegExp(`(${P})(${P})\\s*的?\\s*长(?:度)?`, "g")

/**
 * 读出题面里的**目标**（只认两类：两线段垂直、某线段的长）。
 *
 * 注意 `平面 ABC ⊥ 平面 ACD` **不会**被认成目标：它说的是三点的平面，
 * 而这里要求 `⊥` 两边各是一条**两点的线段**；平面名会让这个匹配直接失败（已由用例钉住）。
 */
export function readRectangleFoldGoals(prompt: string): { kind: "perpendicular" | "length"; sourceText: string; segments: [[string, string], [string, string]] | [[string, string]]; start: number }[] {
  const goals: { kind: "perpendicular" | "length"; sourceText: string; segments: [[string, string], [string, string]] | [[string, string]]; start: number }[] = []
  const seen = new Set<string>()
  /**
   * **只把"问句区"里的垂直/长度当目标**：题设区里的 `BD⊥AC` 是**条件**，不是要证的结论。
   * 没有 `求证 / 证明 / 求` 就说明这道题没有提目标 —— 那时既不该答，也不该因此拒绝出图。
   */
  const goalStart = ((): number => {
    const match = /(?:求证|证明|求)/.exec(prompt)
    return match === null ? Number.POSITIVE_INFINITY : match.index
  })()
  if (!Number.isFinite(goalStart)) return []
  for (const match of prompt.matchAll(PERPENDICULAR_GOAL)) {
    if (match.index < goalStart) continue
    const key = `${match[1]}${match[2]}|${match[3]}${match[4]}`
    if (seen.has(key)) continue
    seen.add(key)
    goals.push({
      kind: "perpendicular",
      sourceText: match[0],
      segments: [[match[1]!, match[2]!], [match[3]!, match[4]!]],
      start: match.index
    })
  }
  for (const match of prompt.matchAll(LENGTH_GOAL)) {
    if (match.index < goalStart) continue
    const key = `${match[1]}${match[2]}`
    if (seen.has(key)) continue
    seen.add(key)
    goals.push({ kind: "length", sourceText: match[0], segments: [[match[1]!, match[2]!]], start: match.index })
  }
  return goals.sort((left, right) => left.start - right.start)
}

function postNameOf(spec: RectangleSpec, geometry: RectangleFoldGeometry, name: string): string {
  return name === spec.apex && geometry.apexPostName !== spec.apex ? geometry.apexPostName : name
}

/** 在**折后**坐标上回答目标。垂直给残差，长度给数值。 */
export function evaluateRectangleFoldGoals(prompt: string, spec: RectangleSpec, geometry: RectangleFoldGeometry): RectangleFoldGoalFinding[] {
  const findings: RectangleFoldGoalFinding[] = []
  for (const goal of readRectangleFoldGoals(prompt)) {
    if (goal.kind === "perpendicular") {
      const [first, second] = goal.segments as [[string, string], [string, string]]
      const result = evaluatePerpendicular(
        geometry.post,
        [postNameOf(spec, geometry, first[0]), postNameOf(spec, geometry, first[1])],
        [postNameOf(spec, geometry, second[0]), postNameOf(spec, geometry, second[1])]
      )
      findings.push({
        kind: "perpendicular",
        sourceText: goal.sourceText,
        segments: [first, second],
        holds: result.holds,
        residual: result.residual,
        detail: result.detail
      })
      continue
    }
    const segment = (goal.segments as [[string, string]])[0]
    const result = evaluateLength(geometry.post, [postNameOf(spec, geometry, segment[0]), postNameOf(spec, geometry, segment[1])])
    findings.push({ kind: "length", sourceText: goal.sourceText, segment, value: result.value, detail: result.detail })
  }
  return findings
}

function foldPlanOf(spec: RectangleSpec, geometry: RectangleFoldGeometry): Extract<PlanEnvelope, { kind: "plan" }> {
  const pointOf = (name: string): { x: number; y: number; z: number } => {
    const point = geometry.pre[name]
    if (point === undefined) throw new Error(`missing pre-fold point ${name}`)
    return point
  }
  const apexAs = geometry.apexPostName
  const actions = [
    {
      actionId: "solid.create_face",
      actionKey: "fixed",
      factIds: [],
      inputs: {
        alias: "fixed",
        vertexNames: [...spec.fixed],
        vertices: spec.fixed.map(pointOf),
        label: `固定片 ${spec.fixed.join("")}`
      }
    },
    {
      actionId: "solid.fold",
      actionKey: "flap",
      factIds: [],
      inputs: {
        alias: "flap",
        vertexNames: [...spec.moving],
        vertices: spec.moving.map(pointOf),
        hinge: { from: spec.hinge[0], to: spec.hinge[1] },
        apex: spec.apex,
        apexAs,
        angle: geometry.angleDegrees,
        label: `折起的三角形 ${apexAs}${spec.hinge.join("")}`
      }
    }
  ]
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: `矩形 ${spec.ring.join("")} 沿 ${spec.hinge.join("")} 把 △${spec.moving.join("")} 折起 ${geometry.angleDegrees}°`,
    factIds: [],
    actions
  } as unknown as Extract<PlanEnvelope, { kind: "plan" }>
}

/**
 * 题面 → 计划 / 澄清。这是 A3 的**模块级入口**（还没有接进 planner）。
 *
 * 判定顺序：
 * 1. 不是矩形对角线折叠题 ⇒ `none`；
 * 2. 读得出题设但缺条件 ⇒ `unsupported`（说缺什么）；
 * 3. 折角未知 ⇒ `clarification`（问折角，不默认 90°）；
 * 4. 目标被否定 ⇒ `clarification`（解释哪条不成立 + 可给的距离），**不出计划**；
 * 5. 其余 ⇒ `plan`（动作链可交给 `compilePlan`）。
 */
export function solveRectangleFold(prompt: string, options: { branch?: 1 | -1; apexAs?: string } = {}): RectangleFoldSolution {
  const read = readRectangleFold(prompt)
  if (read.status === "none") return { status: "none" }
  if (read.status === "unsupported") return { status: "unsupported", reason: read.reason, ...(read.sourceText === undefined ? {} : { sourceText: read.sourceText }) }
  const spec = read.spec
  const built = buildRectangleFold(spec, options.branch === undefined ? {} : { branch: options.branch })
  if (built.status === "needs_angle") return { status: "clarification", reason: "needs_fold_angle", questions: [built.question], spec, findings: [] }
  if (built.status === "unsupported") return { status: "unsupported", reason: built.reason }

  const geometry = built.geometry
  const findings = evaluateRectangleFoldGoals(prompt, spec, geometry)
  const disproved = findings.filter((finding): finding is PerpendicularGoalFinding => finding.kind === "perpendicular" && !finding.holds)
  if (disproved.length > 0) {
    const lengths = findings.filter((finding): finding is LengthGoalFinding => finding.kind === "length")
    const explanation = [
      `按题设核验后，「${disproved.map((finding) => finding.sourceText).join("」「")}」**不成立**：${disproved.map((finding) => finding.detail).join(" ")}`,
      `这条结论是对题设（矩形边长 + 折角来源）的直接回代，不是"没搜到"；因此本轮不会生成可提交的草稿。`,
      ...lengths.map((finding) => `可以给出的是距离：${finding.detail}`)
    ].join("\n")
    return { status: "clarification", reason: "goal_does_not_hold", questions: [explanation], spec, geometry, findings }
  }

  // 出计划之前先自检：构造本身必须通过折前/折后两份点表的全部判据。
  const verified = verifyRectangleFold(spec, { pre: geometry.pre, post: geometry.post })
  if (verified.status !== "passed") {
    const failed = verified.checks.filter((check) => check.status === "failed").map((check) => `${check.id}：${check.detail}`)
    return { status: "unsupported", reason: `构造自检未通过：${failed.join("；")}` }
  }

  /**
   * 计划里的折后点名：
   * - 题面**显式**给了（`至 △AB′C`）就照题面；
   * - 否则生成一个题面没占用的显示名（`B′`），并同步**折后状态表**的键 ——
   *   这样"文档里的 B′"与"我们算出的折后位置"是同一个名字，回代不会张冠李戴。
   */
  const apexAs = options.apexAs ?? (spec.fold.explicitPostName ? spec.fold.displayPostName : uniqueFoldDisplayName(prompt, spec.apex))
  const post: RectangleFoldGeometry["post"] = { ...geometry.post }
  if (apexAs !== geometry.apexPostName) {
    const folded = post[geometry.apexPostName]
    if (folded !== undefined) {
      delete post[geometry.apexPostName]
      post[apexAs] = folded
    }
  }
  const withName: RectangleFoldGeometry = { ...geometry, apexPostName: apexAs, post }
  return { status: "plan", plan: foldPlanOf(spec, withName), spec, geometry: withName, findings }
}
