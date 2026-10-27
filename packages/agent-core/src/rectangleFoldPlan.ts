import { POINT_NAME_SOURCE } from "@draw/geometry-kernel"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { foldPointAboutHinge } from "./foldChain"
import { readNamedFolds, uniqueFoldDisplayName, type NamedFoldRead } from "./namedFold"
import {
  buildRectangleFold,
  evaluateLength,
  evaluatePerpendicular,
  readRectangleFold,
  readRectangleFoldCore,
  verifyRectangleFold,
  type PointTable,
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

function postNameOf(spec: RectangleSpec, geometry: RectangleFoldGeometry, name: string, renames: Record<string, string> = {}): string {
  const renamed = renames[name]
  if (renamed !== undefined) return renamed
  return name === spec.apex && geometry.apexPostName !== spec.apex ? geometry.apexPostName : name
}

/** 在**折后**坐标上回答目标。垂直给残差，长度给数值。 */
export function evaluateRectangleFoldGoals(
  prompt: string,
  spec: RectangleSpec,
  geometry: RectangleFoldGeometry,
  /**
   * **改名表**：连续折叠里可能有两笔各自改过名（`B ⇒ B′`、`A ⇒ A′`），
   * 目标句里用的是**折后**的名字吗？不一定 —— 题面常写 `求折后 AD 的长` 这种"还用原名"的说法。
   * 这张表把"原名 → 折后名"一次说清，判据不自己猜。
   */
  renames: Record<string, string> = {}
): RectangleFoldGoalFinding[] {
  const findings: RectangleFoldGoalFinding[] = []
  for (const goal of readRectangleFoldGoals(prompt)) {
    if (goal.kind === "perpendicular") {
      const [first, second] = goal.segments as [[string, string], [string, string]]
      const result = evaluatePerpendicular(
        geometry.post,
        [postNameOf(spec, geometry, first[0], renames), postNameOf(spec, geometry, first[1], renames)],
        [postNameOf(spec, geometry, second[0], renames), postNameOf(spec, geometry, second[1], renames)]
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
    const result = evaluateLength(geometry.post, [postNameOf(spec, geometry, segment[0], renames), postNameOf(spec, geometry, segment[1], renames)])
    findings.push({ kind: "length", sourceText: goal.sourceText, segment, value: result.value, detail: result.detail })
  }
  return findings
}

function foldPlanOf(spec: RectangleSpec, geometry: RectangleFoldGeometry, disclosure?: string): Extract<PlanEnvelope, { kind: "plan" }> {
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
    goal: `矩形 ${spec.ring.join("")} 沿 ${spec.hinge.join("")} 把 △${spec.moving.join("")} 折起 ${geometry.angleDegrees}°${disclosure === undefined ? "" : `（${disclosure}）`}`,
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
/**
 * **折角没写、但题面给了一条"折后某段长度"**（2026-10-27，§9 第 4 条的前半）。
 *
 * 卷面上这一族很常见：`沿对角线 AC 把 △ABC 折起，使 BD=3，求折角` —— 折角没给，
 * 但折后那个点的位置随折角连续变化，一条长度条件把它**唯一确定**。
 * 旧实现一律回"请补充折角"（探针实测），等于把一道有唯一解的题判成条件不足。
 *
 * ## 只认"使 …=n"
 *
 * 条件是**折后**的，`使` 这个词是它区别于题设区条件的标记。`使 BD=3` 与 `使 B′D=3` 都收：
 * 折起句之后写的 `BD` 指折后的那条（折前 `|BD|` 由边长唯一确定，与题面矛盾时求解会如实报"解不出"）。
 *
 * ## 数值求解与失败方式
 *
 * 折角 `θ ∈ [0°, 180°]` 扫一遍（0.1° 步长）+ 二分收敛；**只接受恰好一个解**：
 * 没有解就说清"解不出 + 能到达的范围"，有两个以上的解就说清"不止一个"并列出候选
 * —— 挑一个等于替题面改题。
 */
interface FoldDistanceConstraint {
  segment: [string, string]
  value: number
  sourceText: string
}

export function readFoldDistanceConstraints(prompt: string): FoldDistanceConstraint[] {
  const pattern = new RegExp(`使\\s*\\|?\\s*(${P})(${P})\\s*\\|?\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`, "g")
  const constraints: FoldDistanceConstraint[] = []
  const seen = new Set<string>()
  for (const match of prompt.matchAll(pattern)) {
    const value = Number(match[3])
    if (!Number.isFinite(value) || !(value > 0)) continue
    const key = `${match[1]}${match[2]}`
    if (seen.has(key)) continue
    seen.add(key)
    constraints.push({ segment: [match[1]!, match[2]!], value, sourceText: match[0] })
  }
  return constraints
}

type FoldAngleSolution =
  | { status: "ok"; angleDegrees: number; constraint: FoldDistanceConstraint; apexName: string }
  | { status: "none" }
  | { status: "unsolvable"; questions: string[] }

export function solveRectangleFoldAngle(prompt: string, spec: RectangleSpec): FoldAngleSolution {
  const constraints = readFoldDistanceConstraints(prompt)
  if (constraints.length === 0) return { status: "none" }
  // 折前点表与角度无关：拿一个占位角编一份出来取坐标（不重复写一份矩形构造）。
  const probe = buildRectangleFold(spec, { angleDegrees: 90 })
  if (probe.status !== "ok") return { status: "none" }
  const pre = probe.geometry.pre
  const apexNames = new Set([spec.apex, spec.fold.displayPostName])
  /**
   * **`B` 与 `B′` 在条件里是同一个点**：题面写 `使 B′D=3` 还是 `使 BD=3`，说的都是
   * "折后那个顶点到 D 的距离"（撇只是把折后位置与折前位置分开）。所以比较时**去掉撇与下标**，
   * 否则同一句话换个记号就解不出折角。
   */
  const bareName = (name: string): string => name.replace(/[′'₁₂₃₄₅₆]/g, "")
  const apexBare = bareName(spec.apex)
  const isApexName = (name: string): boolean => apexNames.has(name) || bareName(name) === apexBare
  const constraint = constraints.find(
    (entry) => entry.segment.some(isApexName) && entry.segment.every((name) => isApexName(name) || pre[name] !== undefined)
  )
  if (constraint === undefined) return { status: "none" }

  const apex = pre[spec.apex]!
  const otherName = constraint.segment.find((name) => !isApexName(name))
  if (otherName === undefined) return { status: "none" }
  const other = pre[otherName]!
  const distanceAt = (degrees: number): number => {
    const folded = foldPointAboutHinge(apex, pre[spec.hinge[0]]!, pre[spec.hinge[1]]!, degrees)
    return Math.hypot(folded.x - other.x, folded.y - other.y, folded.z - other.z)
  }

  const STEP = 0.1
  const samples: { degrees: number; gap: number }[] = []
  for (let degrees = 0; degrees <= 180 + 1e-9; degrees += STEP) {
    samples.push({ degrees, gap: distanceAt(degrees) - constraint.value })
  }
  const roots: number[] = []
  for (let index = 0; index + 1 < samples.length; index += 1) {
    const left = samples[index]!
    const right = samples[index + 1]!
    if (Math.abs(left.gap) <= 1e-12) {
      roots.push(left.degrees)
      continue
    }
    if (left.gap * right.gap > 0) continue
    let low = left.degrees
    let high = right.degrees
    let lowGap = left.gap
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const middle = (low + high) / 2
      const middleGap = distanceAt(middle) - constraint.value
      if (middleGap === 0) {
        low = middle
        high = middle
        break
      }
      if (lowGap * middleGap < 0) high = middle
      else {
        low = middle
        lowGap = middleGap
      }
    }
    roots.push((low + high) / 2)
  }
  const distinct = roots
    .sort((left, right) => left - right)
    .filter((entry, index, all) => index === 0 || Math.abs(entry - all[index - 1]!) > 1e-6)

  const label = `|${constraint.segment.join("")}|`
  /**
   * **题面怎么叫那个折后点，计划里就叫什么**：`使 B′D=3` 里的 `B′` 就是折后位置的**名字**。
   * 以前这里会用 `uniqueFoldDisplayName` 生成一个"题面没占用"的名字 ⇒ 题面写 `B′` 时它躲开 `B′`
   * 生成 `B′′`，于是那条条件在候选文档上找不到点（实测：`verification not_supported` + oracle 缺点名 `B′`）。
   */
  const apexName = constraint.segment.find(isApexName)!
  if (distinct.length === 1) return { status: "ok", angleDegrees: distinct[0]!, constraint, apexName }
  if (distinct.length === 0) {
    const distances = samples.map((sample) => sample.gap + constraint.value)
    const min = Math.min(...distances)
    const max = Math.max(...distances)
    return {
      status: "unsolvable",
      questions: [
        `折角解不出：题面要求 ${constraint.sourceText}，而折后 ${label} 只能取 ${min.toFixed(2)}～${max.toFixed(2)}（折角 0°～180°）—— ${constraint.value} 不在这个范围里。`,
        `请检查这条长度条件，或改用"折起 n°" / "平面 … ⊥ 平面 …" 直接给出折角。`
      ]
    }
  }
  return {
    status: "unsolvable",
    questions: [
      `折角不唯一：${constraint.sourceText} 在 0°～180° 之间有 ${distinct.length} 个解（${distinct.map((degrees) => `${degrees.toFixed(2)}°`).join("、")}），挑一个就是替题面改题。`,
      `请补充能区分它们的条件（例如指明折起方向，或再给一条折后长度）。`
    ]
  }
}

/**
 * **连续两次折起**（2026-10-27，§9 第 4 条后半）。
 *
 * 题面：`矩形 ABCD 中，AB=4，BC=2，先沿对角线 AC 把 △ABC 折起 90° 至 △AB′C，
 * 再沿 B′C 把 △AB′C 折起 30° 至 △A′B′C。`
 *
 * 与单折的差别**只有状态**：第二笔折的是**第一笔折后的那张面**，所以它的点名可以是折后名（`B′`）。
 * 其余口径与单折一致：两笔都要明确的折角、逐步自检（折痕不动 / 刚体 / 角度）、
 * 目标在**最终**点表上回代（带改名表）。
 *
 * ## 为什么不去"只画一笔"
 *
 * 少画一笔的图看起来完全正常，核验还可能是 `passed`（探针实测）。所以这里一旦某一步读不全，
 * 就**不出计划**：第二笔读不出、缺折角、点名在第一步之后的点表里不存在 —— 三族各自说清。
 */
export function solveRectangleFoldChain(prompt: string, options: { branch?: 1 | -1 } = {}): RectangleFoldSolution {
  const read = readRectangleFoldCore(prompt)
  if (read.status === "none") return { status: "none" }
  if (read.status === "unsupported") return { status: "unsupported", reason: read.reason, ...(read.sourceText === undefined ? {} : { sourceText: read.sourceText }) }
  const spec = read.spec

  const folds = readNamedFolds(prompt)
  const invalid = folds.find((entry): entry is Extract<NamedFoldRead, { status: "invalid" }> => entry.status === "invalid")
  if (invalid !== undefined) return { status: "unsupported", reason: invalid.reason, sourceText: invalid.sourceText }
  const usable = folds.filter((entry): entry is Extract<NamedFoldRead, { status: "ok" }> => entry.status === "ok")
  if (usable.length !== 2) {
    return { status: "unsupported", reason: `连续折叠目前只支持两笔，这道题里读到 ${usable.length} 笔折起。` }
  }
  const second = usable[1]!

  // 两笔的折角都必须**明写**：多笔折起时的"未知折角"还没有求解器，不猜。
  if (spec.angle.kind !== "given") {
    return { status: "clarification", reason: "needs_fold_angle", questions: [`第一笔折起没有给折角（${spec.fold.source.text}），连续折叠目前不会自动求解。请补充折角。`], spec, findings: [] }
  }
  if (second.transition.angle.kind !== "given") {
    return { status: "clarification", reason: "needs_fold_angle", questions: [`第二笔折起（${second.transition.source.text}）没有给折角。连续折叠里两笔的折角都要明写。`], spec, findings: [] }
  }

  const built = buildRectangleFold(spec, { angleDegrees: spec.angle.degrees, ...(options.branch === undefined ? {} : { branch: options.branch }) })
  if (built.status !== "ok") return { status: "unsupported", reason: built.status === "needs_angle" ? built.question : built.reason }
  const state1 = built.geometry.post
  const apexAs1 = built.geometry.apexPostName

  // 第二笔用到的每一个点名都必须在"第一笔折后"的点表里 —— 不许拿别的点凑。
  const referenced = [...second.face, ...second.hingeNames, second.apex]
  const missing = [...new Set(referenced.filter((name) => state1[name] === undefined))]
  if (missing.length > 0) {
    return {
      status: "unsupported",
      reason: `第二笔折起（${second.transition.source.text}）点到 ${missing.join("、")}，但这些点在第一笔折后都不存在（那时图上只有 ${Object.keys(state1).join("、")}）。它折的是第一笔折后的面，点名的写法要能对上。`
    }
  }

  const apex2 = second.apex
  const apexAs2 = second.transition.explicitPostName ? second.transition.displayPostName : uniqueFoldDisplayName(prompt, apex2)
  if (apexAs2 === apex2) return { status: "unsupported", reason: `第二笔折起的折后点名与折前相同（${apex2}），无法区分两个位置。` }
  if (state1[apexAs2] !== undefined) return { status: "unsupported", reason: `第二笔折起的折后点名 ${apexAs2} 在第一笔折后已经存在，不能用同一个名字表示两个位置。` }

  const rotated = foldPointAboutHinge(state1[apex2]!, state1[second.hingeNames[0]]!, state1[second.hingeNames[1]]!, second.transition.angle.degrees)
  const state2: PointTable = { ...state1, [apexAs2]: rotated }
  delete state2[apex2]

  const step1 = verifyRectangleFold(spec, { pre: built.geometry.pre, post: state1 }, { angleDegrees: spec.angle.degrees })
  if (step1.status !== "passed") {
    return { status: "unsupported", reason: `第一笔折起的自检未通过：${step1.checks.filter((check) => check.status === "failed").map((check) => `${check.id}：${check.detail}`).join("；")}` }
  }
  const step2 = verifySecondFold(state1, state2, second, apex2, apexAs2)
  if (!step2.ok) return { status: "unsupported", reason: `第二笔折起的自检未通过：${step2.reason}` }

  const geometry: RectangleFoldGeometry = { ...built.geometry, post: state2, apexPostName: apexAs1 }
  const renames = { [spec.apex]: apexAs1, [apex2]: apexAs2 } as Record<string, string>
  const findings = evaluateRectangleFoldGoals(prompt, spec, geometry, renames)
  const disproved = findings.filter((finding): finding is PerpendicularGoalFinding => finding.kind === "perpendicular" && !finding.holds)
  if (disproved.length > 0) {
    const explanation = [
      `按两笔折起的回代，「${disproved.map((finding) => finding.sourceText).join("」「")}」**不成立**：${disproved.map((finding) => finding.detail).join(" ")}`,
      `这条结论是对题设（矩形边长 + 两笔折角）的直接回代，不是"没搜到"；因此本轮不会生成可提交的草稿。`
    ].join("\n")
    return { status: "clarification", reason: "goal_does_not_hold", questions: [explanation], spec, geometry, findings }
  }

  return { status: "plan", plan: chainPlanOf(spec, built.geometry.pre, state1, second, apexAs1, apexAs2), spec, geometry, findings }
}

/** 第二笔折起的三条判据：折痕不动、折片刚性、转过给定角度；其余点一个都不许动。 */
function verifySecondFold(
  state1: PointTable,
  state2: PointTable,
  second: Extract<NamedFoldRead, { status: "ok" }>,
  apex: string,
  apexAs: string
): { ok: true } | { ok: false; reason: string } {
  const [h0, h1] = second.hingeNames
  const before = { apex: state1[apex]!, h0: state1[h0]!, h1: state1[h1]! }
  const after = { apex: state2[apexAs]!, h0: state2[h0]!, h1: state2[h1]! }
  const scale = Math.max(1, Math.hypot(before.apex.x - before.h0.x, before.apex.y - before.h0.y, before.apex.z - before.h0.z))
  const tolerance = 1e-9 * scale
  for (const key of ["h0", "h1"] as const) {
    const moved = Math.hypot(after[key].x - before[key].x, after[key].y - before[key].y, after[key].z - before[key].z)
    if (moved > tolerance) return { ok: false, reason: `折痕上的 ${key === "h0" ? h0 : h1} 被移动了 ${moved}（折痕上的点必须不动）。` }
  }
  for (const key of ["h0", "h1"] as const) {
    const was = Math.hypot(before.apex.x - before[key].x, before.apex.y - before[key].y, before.apex.z - before[key].z)
    const now = Math.hypot(after.apex.x - after[key].x, after.apex.y - after[key].y, after.apex.z - after[key].z)
    if (Math.abs(was - now) > 1e-9 * Math.max(1, was)) return { ok: false, reason: `折片不是刚体：${apex} 到 ${key === "h0" ? h0 : h1} 的距离从 ${was} 变成 ${now}。` }
  }
  const angle = rotationAngleDegrees(before.apex, after.apex, before.h0, before.h1)
  if (angle === null) return { ok: false, reason: `量不出第二笔折角（折片退化）。` }
  const expected = second.transition.angle.kind === "given" ? second.transition.angle.degrees : null
  if (expected === null) return { ok: false, reason: `第二笔折起没有明确折角，环没有可核的角。` }
  if (Math.abs(angle - expected) > 1e-6) return { ok: false, reason: `第二笔的折角应是 ${expected}°，实测 ${angle}°。` }
  for (const [name, point] of Object.entries(state1)) {
    if (name === apex || name === h0 || name === h1) continue
    const other = state2[name]
    if (other === undefined) return { ok: false, reason: `${name} 在第二笔之后消失了。` }
    if (Math.hypot(other.x - point.x, other.y - point.y, other.z - point.z) > tolerance) return { ok: false, reason: `${name} 不是第二笔折起的点，却被移动了。` }
  }
  return { ok: true }
}

/** 绕轴旋转的角度（度）：把两个点都投影到垂直于轴的方向，再取夹角。退化返回 `null`。 */
function rotationAngleDegrees(before: { x: number; y: number; z: number }, after: { x: number; y: number; z: number }, origin: { x: number; y: number; z: number }, far: { x: number; y: number; z: number }): number | null {
  const axis = { x: far.x - origin.x, y: far.y - origin.y, z: far.z - origin.z }
  const length = Math.hypot(axis.x, axis.y, axis.z)
  if (!(length > 1e-12)) return null
  const unit = { x: axis.x / length, y: axis.y / length, z: axis.z / length }
  const project = (point: { x: number; y: number; z: number }) => {
    const vector = { x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z }
    const along = vector.x * unit.x + vector.y * unit.y + vector.z * unit.z
    return { x: vector.x - along * unit.x, y: vector.y - along * unit.y, z: vector.z - along * unit.z }
  }
  const left = project(before)
  const right = project(after)
  const leftLength = Math.hypot(left.x, left.y, left.z)
  const rightLength = Math.hypot(right.x, right.y, right.z)
  if (!(leftLength > 1e-12) || !(rightLength > 1e-12)) return null
  const cosine = Math.max(-1, Math.min(1, (left.x * right.x + left.y * right.y + left.z * right.z) / (leftLength * rightLength)))
  return (Math.acos(cosine) * 180) / Math.PI
}

/** 连续两笔折起的动作链：固定片 → 第一笔折起 → 第二笔折起（第二笔的坐标取**第一笔折后**的点表）。 */
function chainPlanOf(
  spec: RectangleSpec,
  pre: PointTable,
  state1: PointTable,
  second: Extract<NamedFoldRead, { status: "ok" }>,
  apexAs1: string,
  apexAs2: string
): Extract<PlanEnvelope, { kind: "plan" }> {
  const pick = (table: PointTable, name: string): { x: number; y: number; z: number } => {
    const point = table[name]
    if (point === undefined) throw new Error(`missing point ${name}`)
    return { x: point.x, y: point.y, z: point.z }
  }
  const angle1 = spec.angle.kind === "given" ? spec.angle.degrees : 0
  const angle2 = second.transition.angle.kind === "given" ? second.transition.angle.degrees : 0
  const actions = [
    {
      actionId: "solid.create_face",
      actionKey: "fixed",
      factIds: [],
      inputs: { alias: "fixed", vertexNames: [...spec.fixed], vertices: spec.fixed.map((name) => pick(pre, name)), label: `固定片 ${spec.fixed.join("")}` }
    },
    {
      actionId: "solid.fold",
      actionKey: "flap",
      factIds: [],
      inputs: {
        alias: "flap",
        vertexNames: [...spec.moving],
        vertices: spec.moving.map((name) => pick(pre, name)),
        hinge: { from: spec.hinge[0], to: spec.hinge[1] },
        apex: spec.apex,
        apexAs: apexAs1,
        angle: angle1,
        label: `第一笔：折起的三角形 ${apexAs1}${spec.hinge.join("")}`
      }
    },
    {
      actionId: "solid.fold",
      actionKey: "flap2",
      factIds: [],
      inputs: {
        alias: "flap2",
        vertexNames: [...second.face],
        vertices: second.face.map((name) => pick(state1, name)),
        hinge: { from: second.hingeNames[0], to: second.hingeNames[1] },
        apex: second.apex,
        apexAs: apexAs2,
        angle: angle2,
        label: `第二笔：折起的三角形 ${second.face.map((name) => (name === second.apex ? apexAs2 : name)).join("")}`
      }
    }
  ]
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: `矩形 ${spec.ring.join("")} 连续两笔折起：沿 ${spec.hinge.join("")} 把 △${spec.moving.join("")} 折起 ${angle1}°，再沿 ${second.hingeNames.join("")} 把 △${second.face.join("")} 折起 ${angle2}°`,
    factIds: [],
    actions
  } as unknown as Extract<PlanEnvelope, { kind: "plan" }>
}

export function solveRectangleFold(prompt: string, options: { branch?: 1 | -1; apexAs?: string } = {}): RectangleFoldSolution {
  /**
   * **题面里有第二笔折起 ⇒ 走链式这条路**（2026-10-27，§9 第 4 条后半）。
   *
   * 单折入口（`readRectangleFold`）对多笔题面是**明确拒绝**的（它以前会静默只折第一笔）。
   * 这里先把"两笔"这种情形分流出去，链式入口会把两笔都画出来；第二笔读不出、缺折角、
   * 点名不存在时，链式入口自己会给出澄清或拒绝 —— 都不会退化成"只画一笔"。
   */
  if (readNamedFolds(prompt).length > 1) return solveRectangleFoldChain(prompt, options)
  const read = readRectangleFold(prompt)
  if (read.status === "none") return { status: "none" }
  if (read.status === "unsupported") return { status: "unsupported", reason: read.reason, ...(read.sourceText === undefined ? {} : { sourceText: read.sourceText }) }
  const spec = read.spec
  const built = buildRectangleFold(spec, options.branch === undefined ? {} : { branch: options.branch })
  /**
   * **折角未知 ⇒ 先试着从"折后某段长度"解出来**（2026-10-27）。
   *
   * 三种结局分开处理（fail-closed）：
   * - 恰好一个解 ⇒ 用解出的角重建几何，并把这个角**写进计划的目标句**（"由「使 BD=3」解出"）；
   * - 一个解都没有 / 有多个解 ⇒ 沿用 `needs_fold_angle` 这条终态，但问题正文换成
   *   求解给出的具体理由（能到达的范围 / 候选角）；
   * - 题面里根本没有这条条件 ⇒ 与以前一字不变（问折角）。
   */
  const solvedAngle: { geometry: RectangleFoldGeometry; disclosure?: string; apexName?: string } | { questions: string[] } | null = (() => {
    if (built.status !== "needs_angle") return null
    const solved = solveRectangleFoldAngle(prompt, spec)
    if (solved.status === "none") return null
    if (solved.status === "unsolvable") return { questions: solved.questions }
    const rebuilt = buildRectangleFold(spec, { angleDegrees: solved.angleDegrees, ...(options.branch === undefined ? {} : { branch: options.branch }) })
    if (rebuilt.status !== "ok") return null
    return {
      geometry: rebuilt.geometry,
      ...(solved.apexName === spec.apex ? {} : { apexName: solved.apexName }),
      disclosure: `折角 ${solved.angleDegrees.toFixed(2)}° 由「${solved.constraint.sourceText}」解出（按折后 ${solved.constraint.segment.join("")} 的距离理解）`
    }
  })()
  if (solvedAngle !== null && "questions" in solvedAngle) {
    return { status: "clarification", reason: "needs_fold_angle", questions: solvedAngle.questions, spec, findings: [] }
  }
  if (built.status === "needs_angle" && solvedAngle === null) {
    return { status: "clarification", reason: "needs_fold_angle", questions: [built.question], spec, findings: [] }
  }
  if (built.status === "unsupported") return { status: "unsupported", reason: built.reason }

  const geometry = solvedAngle !== null && "geometry" in solvedAngle ? solvedAngle.geometry : (built as { geometry: RectangleFoldGeometry }).geometry
  const angleDisclosure = solvedAngle !== null && "disclosure" in solvedAngle ? solvedAngle.disclosure : undefined
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
  // 解出来的折角也要让自检知道（`spec.angle` 那一侧是"未知"，不传就等于拿不到折角这条判据）。
  const verified = verifyRectangleFold(spec, { pre: geometry.pre, post: geometry.post }, angleDisclosure === undefined ? {} : { angleDegrees: geometry.angleDegrees })
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
  const solvedApexName = solvedAngle !== null && "apexName" in solvedAngle ? solvedAngle.apexName : undefined
  const apexAs = options.apexAs ?? (spec.fold.explicitPostName ? spec.fold.displayPostName : (solvedApexName ?? uniqueFoldDisplayName(prompt, spec.apex)))
  const post: RectangleFoldGeometry["post"] = { ...geometry.post }
  if (apexAs !== geometry.apexPostName) {
    const folded = post[geometry.apexPostName]
    if (folded !== undefined) {
      delete post[geometry.apexPostName]
      post[apexAs] = folded
    }
  }
  const withName: RectangleFoldGeometry = { ...geometry, apexPostName: apexAs, post }
  return { status: "plan", plan: foldPlanOf(spec, withName, angleDisclosure), spec, geometry: withName, findings }
}
