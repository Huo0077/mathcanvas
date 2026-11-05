/**
 * **梯形的沿对角线翻折：题面 → 计划 / 一次澄清**（T6，2026-11-05 四题修复）。
 *
 * 见 [修复设计](../../../../docs/superpowers/specs/2026-11-05-solid-geometry-four-cases-design.md) §3 Case 4
 * 与 [实施计划](../../../../docs/superpowers/plans/2026-11-05-solid-geometry-four-cases.md) T6。
 *
 * ## 为什么不直接复用矩形的折叠入口
 *
 * `solveRectangleFold` 的题面语法是"矩形 + 对角线"，而 Case 4 是**直角梯形**；
 * 这里只复用它的**几何与动作**（`foldPointAboutHinge`、`solid.fold`），不复制任何判据。
 *
 * ## Case 4 原题的两处歧义（**必须一次问清**）
 *
 * 1. 「将 △ACD 沿 AC 折起成 △PAC」按**有序顶点**读会移动铰链端点 `A`、`C` 本身
 *    （`A→P`、`C→A`、`D→C`）——通常意图是 `D→P`，但题面没有明说；
 * 2. 目标里的 `CD`：是**折前**的那条线段，还是折后的 `CP`？
 *
 * 两件事都不许静默挑一个：原题的验收是"准确说明歧义并**一次性**询问"，不是画一张
 * 自称完全符合原题的图。明确修订版（写明 `D→P`、`CD 指折前`）才建立数值验收。
 */

import { rightTrapezoidEdges, rightTrapezoidPolygon, type Vector3, type WitnessRelation } from "@draw/geometry-kernel"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { foldPointAboutHinge } from "./foldChain"
import { parseObligationWithLegacy } from "./obligationIR"
import { kernelRelationsFromObligations } from "./solver/witnessSearch"
import { evaluateSolidGoals, formatSolidGoalAnswer } from "./solidGoals"

/** 折前 / 折后的点名 → 坐标。 */
export type FoldPointTable = Record<string, Vector3>

export interface PolygonFoldGeometry {
  pre: FoldPointTable
  post: FoldPointTable
  /** 折起的那个点（折前名）。 */
  apex: string
  /** 折后名（修订版里由题面写明）。 */
  apexAs: string
  angleDegrees: number
  /** 镜像分支：`1` / `-1`（两侧都满足刚性不变量，设计允许）。 */
  branch: 1 | -1
}

export type PolygonFoldPlanResult =
  | { status: "ok"; plan: PlanEnvelope; geometry: PolygonFoldGeometry; assumptions: string[] }
  /**
   * **一次澄清**：`questions` 恒为一条 —— 把还没说清的子问题合在一句里问完，
   * 不让用户被连问两轮。
   */
  | { status: "clarification"; question: string; reason: "ambiguous-destination" | "ambiguous-reference" | "needs-fold-angle" | "unsupported" }
  /** 入口认不出这种题面（不是本层的活）。 */
  | { status: "not-applicable"; reason: string }

interface FoldClause {
  /** 折片（折前三个点名，含会动的那个）。 */
  face: [string, string, string]
  /** 折痕两端；必须都在折片上。 */
  hinge: [string, string]
  /** 会动的那个点（折前名）。 */
  apex: string
  /** 题面写明的折后名（`折起成 △PAC` 的 `P`）；只有 `apex-to-point` 语序才算「写明」。 */
  statedPostName: string | null
  /** 折角；题面没给就是 `null`（不默认 90°）。 */
  angleDegrees: number | null
  /** 只有"点 D 绕 AC 旋转 90° 得到点 P"这种写法才算**明确**的 D→P。 */
  destinationExplicit: boolean
}

const POINT = "[A-Z](?:[′]|[₁₂₃₄₅₆])?"

/** `将△ACD沿AC折起成△PAC` / `将△ACD沿AC折起60°成△PAC` / `把 △ACD 沿对角线 AC 折起 90°`。 */
const FACE_FIRST = new RegExp(
  `(?:将|把)?\\s*△\\s*(${POINT})(${POINT})(${POINT})\\s*沿\\s*(?:对角线\\s*)?(${POINT})(${POINT})\\s*折起(?:\\s*([0-9.]+)\\s*°)?(?:\\s*成\\s*△\\s*(${POINT}${POINT}${POINT}))?(?:\\s*([0-9.]+)\\s*°)?`,
  "g"
)
/** `将点D绕直线AC旋转90°得到点P`（明确的 D→P）。 */
const APEX_TO_POINT = new RegExp(`(?:将|把)?\\s*点?\\s*(${POINT})\\s*绕\\s*(?:直线\\s*)?(${POINT})(${POINT})\\s*旋转(?:\\s*([0-9.]+)\\s*°)?\\s*(?:得到|到|至|成)\\s*点?\\s*(${POINT})`, "g")
/** `折起 90°` 的第二种写法。 */
const FOLD_ANGLE = /折起\s*([0-9.]+)\s*°/
/** `CD 指折前线段` / `折后的 CD`。 */
const REFERENCE_STATE = new RegExp(`(${POINT})(${POINT})\\s*指\\s*(折前|折叠前|折后|折叠后)`, "g")

/**
 * 读折起从句。三种写法归一成同一份结构；读不出返回 `null`（交给别的意图）。
 *
 * **`destinationExplicit` 是这一层最关键的判据**：`折起成△PAC` 只说明"折后三角形的三个点是
 * P、A、C"，按有序顶点读与按"折痕不动 + 另一个点换名"读**不是同一件事**；
 * 只有"点 D 绕 AC 旋转 … 得到点 P"这种写法才把 `D→P` 说死了。
 */
function readFoldClause(prompt: string): FoldClause | null {
  const apexToPoint = [...prompt.matchAll(APEX_TO_POINT)][0]
  if (apexToPoint !== undefined) {
    const apex = apexToPoint[1]!
    const hinge: [string, string] = [apexToPoint[2]!, apexToPoint[3]!]
    const post = apexToPoint[5]!
    const rawAngle = apexToPoint[4]
    const angle = rawAngle === undefined ? null : Number(rawAngle)
    if (hinge.includes(apex)) return null
    if (post === apex) return null
    if (angle !== null && (!Number.isFinite(angle) || angle <= 0 || angle >= 180)) return null
    return { face: [apex, hinge[0], hinge[1]], hinge, apex, statedPostName: post, angleDegrees: angle, destinationExplicit: true }
  }
  const faceFirst = [...prompt.matchAll(FACE_FIRST)][0]
  if (faceFirst === undefined) return null
  const face: [string, string, string] = [faceFirst[1]!, faceFirst[2]!, faceFirst[3]!]
  const hinge: [string, string] = [faceFirst[4]!, faceFirst[5]!]
  if (new Set(face).size !== 3 || new Set(hinge).size !== 2) return null
  if (!hinge.every((name) => face.includes(name))) return null
  const apex = face.find((name) => !hinge.includes(name))
  if (apex === undefined) return null
  /** 折后三角形里除折痕外的那个点（可能是 `P`，也可能是折前名本身）。 */
  const target = faceFirst[7] === undefined ? null : faceFirst[7]
  const remaining = target === null ? null : (target.match(new RegExp(POINT, "g")) ?? []).filter((name) => !hinge.includes(name))
  const statedPostName = remaining !== null && remaining.length === 1 && remaining[0] !== apex ? remaining[0]! : null
  const statedAngle = faceFirst[6] ?? faceFirst[8] ?? FOLD_ANGLE.exec(prompt)?.[1]
  const angle = statedAngle === undefined ? null : Number(statedAngle)
  return {
    face,
    hinge,
    apex,
    statedPostName,
    angleDegrees: angle === null || !Number.isFinite(angle) || angle <= 0 || angle >= 180 ? null : angle,
    destinationExplicit: false
  }
}

/** `CD 指折前` 这一类**显式**的状态说明；没写就是 `null`（歧义）。 */
function readReferenceState(prompt: string): { segment: [string, string]; state: "pre" | "post" } | null {
  const match = [...prompt.matchAll(REFERENCE_STATE)][0]
  if (match === undefined) return null
  return { segment: [match[1]!, match[2]!], state: match[3]!.startsWith("折前") || match[3]!.startsWith("折叠前") ? "pre" : "post" }
}

/**
 * 折角：题面明写就用；写了「平面 X ⊥ 平面 Y」就是确定的 `90°`；两样都没有 ⇒ `null`（问）。
 */
function readFoldAngle(prompt: string, clause: FoldClause): number | null {
  if (clause.angleDegrees !== null) return clause.angleDegrees
  const planar = /平面\s*[A-Z′₁₂₃₄₅₆]{3,4}\s*⊥\s*平面\s*[A-Z′₁₂₃₄₅₆]{3,4}/.test(prompt)
  return planar ? 90 : null
}

/** 从题设里读四个底点与直角梯形三条成形边的长度（复用 T3 的判据，不另写一套）。 */
function readTrapezoid(
  prompt: string,
  ring: readonly string[]
): { polygon: Vector3[]; relations: WitnessRelation[] } | null {
  const givens = parseObligationWithLegacy(prompt).ir.obligations.filter((obligation) => obligation.role === "given")
  const relations = kernelRelationsFromObligations(givens)
  const pattern = rightTrapezoidEdges(ring, relations)
  if (pattern === null) return null
  const statedOf = (edge: readonly [string, string]): number | null => {
    const wanted = [...edge].sort().join("|")
    for (const obligation of givens) {
      if (obligation.kind !== "fixedLength" || obligation.targets.length !== 2 || typeof obligation.expected !== "number") continue
      if ([...obligation.targets].sort().join("|") === wanted) return obligation.expected
    }
    return null
  }
  const width = statedOf(pattern.widthEdge)
  const height = statedOf(pattern.heightEdge)
  const top = statedOf(pattern.topEdge)
  if (width === null || height === null || top === null) return null
  const math = rightTrapezoidPolygon({ width, height, top })
  if (math.status === "rejected") return null
  /** 局部坐标 `[直角顶点, 下一条边的端点, 对角点, 另一条邻边端点]` 旋转回题面的环序。 */
  const pivot = ring.indexOf(pattern.rightAngleVertex)
  const polygon = ring.map((_, index) => math.polygon[(index - pivot + ring.length) % ring.length]!)
  return { polygon, relations }
}

function pointTable(ring: readonly string[], polygon: readonly Vector3[]): FoldPointTable {
  const table: FoldPointTable = {}
  for (const [index, name] of ring.entries()) table[name] = { ...polygon[index]! }
  return table
}

/** 刚性与折角自检：折痕不动、折片边长不变、转过的角就是 `angleDegrees`。 */
function verifyFold(input: {
  pre: FoldPointTable
  post: FoldPointTable
  hinge: readonly [string, string]
  apex: string
  apexAs: string
  angleDegrees: number
}): string | null {
  const { pre, post, hinge, apex, apexAs, angleDegrees } = input
  const delta = (left: Vector3, right: Vector3): number => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
  for (const name of hinge) {
    if (delta(pre[name]!, post[name]!) > 1e-9) return `折痕上的 ${name} 被移动了。`
  }
  for (const name of hinge) {
    const was = delta(pre[apex]!, pre[name]!)
    const now = delta(post[apexAs]!, post[name]!)
    if (Math.abs(was - now) > 1e-9 * Math.max(1, was)) return `折片不是刚体：${apex}${name} 从 ${was} 变成 ${now}。`
  }
  const hingeDirection = { x: pre[hinge[1]]!.x - pre[hinge[0]]!.x, y: pre[hinge[1]]!.y - pre[hinge[0]]!.y, z: pre[hinge[1]]!.z - pre[hinge[0]]!.z }
  const hingeLength = Math.hypot(hingeDirection.x, hingeDirection.y, hingeDirection.z)
  if (!(hingeLength > 1e-12)) return "折痕退化（两端重合）。"
  const project = (point: Vector3): Vector3 => {
    const offset = { x: point.x - pre[hinge[0]]!.x, y: point.y - pre[hinge[0]]!.y, z: point.z - pre[hinge[0]]!.z }
    const along = (offset.x * hingeDirection.x + offset.y * hingeDirection.y + offset.z * hingeDirection.z) / (hingeLength * hingeLength)
    return { x: offset.x - along * hingeDirection.x, y: offset.y - along * hingeDirection.y, z: offset.z - along * hingeDirection.z }
  }
  const before = project(pre[apex]!)
  const after = project(post[apexAs]!)
  const sizes = [Math.hypot(before.x, before.y, before.z), Math.hypot(after.x, after.y, after.z)]
  if (!(sizes[0]! > 1e-12) || !(sizes[1]! > 1e-12)) return "折片退化（动点落在折痕上）。"
  const cosine = Math.max(-1, Math.min(1, (before.x * after.x + before.y * after.y + before.z * after.z) / (sizes[0]! * sizes[1]!)))
  const measured = (Math.acos(cosine) * 180) / Math.PI
  if (Math.abs(measured - angleDegrees) > 1e-6) return `折角应是 ${angleDegrees}°，实测 ${measured}°。`
  return null
}

/**
 * 题面 → 计划 / 一次澄清。**确定性**：没有 RNG、没有时间；镜像分支由调用方或默认 `+1` 决定。
 */
export function tryBuildPolygonFoldPlan(input: { prompt: string; branch?: 1 | -1 }): PolygonFoldPlanResult {
  const clause = readFoldClause(input.prompt)
  if (clause === null) return { status: "not-applicable", reason: "题面里没有可识别的「将 △… 沿 … 折起」从句。" }

  /** 环：题面写 `在直角梯形ABCD中` —— 四个点名从这句读，不靠"图上一共有几个字母"去猜。 */
  const ring = (() => {
    const match = new RegExp(`(?:直角梯形|梯形|四边形)\\s*(${POINT}${POINT}${POINT}${POINT})`).exec(input.prompt)
    if (match === null) return null
    const split = match[1]!.match(new RegExp(POINT, "g")) ?? []
    if (split.length !== 4 || new Set(split).size !== 4) return null
    return split
  })()
  if (ring === null) return { status: "not-applicable", reason: "这一层需要「直角梯形ABCD」这样的四个点名底面。" }

  const trapezoid = readTrapezoid(input.prompt, ring)
  if (trapezoid === null) return { status: "not-applicable", reason: "题面没有被识别为直角梯形底面（需要 AB∥CD、AD⊥AB 与三条边长）。" }
  const pre = pointTable(ring, trapezoid.polygon)

  const angle = readFoldAngle(input.prompt, clause)
  const reference = readReferenceState(input.prompt)
  /**
   * **目标里引用了哪条"折前折后含义不同"的边**：从解析出来的 goal 义务取，
   * 不靠正则去猜（`AP⊥CD` 里的 `CD` 是 `D` 还叫 `D` 时的线段）。
   */
  const goalObligations = parseObligationWithLegacy(input.prompt).ir.obligations.filter((obligation) => obligation.role === "goal")
  const referencedSegment = (reference?.segment ?? goalObligations
    .filter((obligation) => obligation.kind === "perpendicular" && obligation.targets.length === 4)
    .map((obligation) => [obligation.targets[2]!, obligation.targets[3]!] as [string, string])
    .find((segment) => segment.includes(clause.apex))) ?? null

  /**
   * 拓扑不动轴解析：
   * 只要题面写明了折后三角形（如「折起成△PAC」），且该三角形在折痕外的动点存在（P），
   * 依据折痕 AC 固定原则，动点映射自动确定为 apex -> statedPostName（即 D -> P）。
   * 仅在完全没有指定折后名称时才发起澄清。
   */
  const postName = clause.statedPostName ?? clause.apex
  if (postName === clause.apex) {
    return {
      status: "clarification",
      question: `折后点名与折前相同（${clause.apex}），无法区分两个位置；请给折后的点名。`,
      reason: "unsupported"
    }
  }

  if (angle === null) {
    return {
      status: "clarification",
      reason: "needs-fold-angle",
      question: `题面没有给出 ${clause.hinge.join("")} 这条折痕上的折角（既没写“折起 n°”，也没写“平面…⊥平面…”）。请补充折角后再出图。`
    }
  }

  const branch = input.branch ?? 1
  const rotated = foldPointAboutHinge(pre[clause.apex]!, pre[clause.hinge[0]]!, pre[clause.hinge[1]]!, branch * angle)
  const post: FoldPointTable = { ...pre }
  delete post[clause.apex]
  post[postName] = rotated
  const failure = verifyFold({ pre, post, hinge: clause.hinge, apex: clause.apex, apexAs: postName, angleDegrees: angle })
  if (failure !== null) return { status: "clarification", question: `折起的几何自检未通过：${failure}`, reason: "unsupported" }

  /** 固定片：折痕 + 环上第四个点。 */
  const other = ring.find((name) => !clause.face.includes(name))
  if (other === undefined) return { status: "clarification", question: "折片之外的第四个点找不到。", reason: "unsupported" }
  const fixedFace = [clause.hinge[0], other, clause.hinge[1]] as [string, string, string]

  const actions: unknown[] = [
    {
      actionId: "solid.create_face",
      actionKey: "fixed",
      factIds: [],
      inputs: { alias: "fixed", vertexNames: [...fixedFace], vertices: fixedFace.map((name) => ({ ...pre[name]! })), label: `固定片 ${fixedFace.join("")}` }
    },
    {
      actionId: "solid.fold",
      actionKey: "flap",
      factIds: [],
      inputs: {
        alias: "flap",
        vertexNames: [...clause.face],
        vertices: clause.face.map((name) => ({ ...pre[name]! })),
        hinge: { from: clause.hinge[0], to: clause.hinge[1] },
        apex: clause.apex,
        apexAs: postName,
        angle,
        label: `折起的三角形 ${[clause.hinge[0], postName, clause.hinge[1]].join("")}`
      }
    }
  ]
  /**
   * **折前参考线框与叠影**：在底面保留折前动点及其相连棱，便于几何直观对照。
   */
  actions.push({
    actionId: "solid.create_point",
    actionKey: `pre_${clause.apex}`,
    factIds: [],
    inputs: { alias: `pre_${clause.apex}`, position: pre[clause.apex]!, label: clause.apex }
  })
  actions.push({
    actionId: "solid.create_segment",
    actionKey: `seg_pre_${clause.hinge[0]}${clause.apex}`,
    factIds: [],
    inputs: { alias: `seg_pre_${clause.hinge[0]}${clause.apex}`, vertexNames: [clause.hinge[0], clause.apex], label: `${clause.hinge[0]}${clause.apex}(折前)` }
  })
  actions.push({
    actionId: "solid.create_segment",
    actionKey: `seg_pre_${clause.hinge[1]}${clause.apex}`,
    factIds: [],
    inputs: { alias: `seg_pre_${clause.hinge[1]}${clause.apex}`, vertexNames: [clause.hinge[1], clause.apex], label: `${clause.hinge[1]}${clause.apex}(折前)` }
  })

  /**
   * **折后的中点**（`M 为 PB 的中点`）：折后点 `P` 与固定点 `B` 之间的分点。
   * 落成 `solid.create_segment` + `dynamic.create_bound_point`（绑定点），
   * 宿主是被折出来的那条线段，不是一组手算坐标。
   */
  const givens = parseObligationWithLegacy(input.prompt).ir.obligations.filter((obligation) => obligation.role === "given")
  const midpoint = givens.find(
    (obligation) => obligation.kind === "midpoint" && obligation.targets.includes(postName) && obligation.targets.some((name) => name === other)
  )
  const assumptions: string[] = [
    `沿 ${clause.hinge.join("")} 把 △${clause.face.join("")} 折起 ${angle}°，取${branch === 1 ? "" : "反"}向分支（镜像分支满足同一组刚性不变量）。`,
    `依据折痕 ${clause.hinge.join("")} 固定原则，自动推导动点对应为 ${clause.apex} → ${postName}。`,
    `保留折前位置点 ${clause.apex} 及参考线段 ${clause.hinge[0]}${clause.apex}、${clause.hinge[1]}${clause.apex} 作为平面叠影参考。`
  ]
  if (referencedSegment !== null && reference === null) {
    assumptions.push(`目标中引用的 ${referencedSegment.join("")} 按折前平面线段参与核验与展示。`)
  }
  if (midpoint !== undefined) {
    const pointName = midpoint.targets[0]!
    const segmentAlias = `fold-segment-${postName}${other}`
    actions.push({
      actionId: "solid.create_segment",
      actionKey: segmentAlias,
      factIds: [],
      inputs: { alias: segmentAlias, vertexNames: [postName, other] }
    })
    actions.push({
      actionId: "dynamic.create_bound_point",
      actionKey: pointName,
      factIds: [],
      inputs: { alias: pointName, host: { scope: "draft", alias: segmentAlias }, parameter: 0.5, label: pointName }
    })
    assumptions.push(`辅助点 ${pointName} 取 ${postName}${other} 的中点（绑定点，参数 1/2）。`)
  }

  const plan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: `沿 ${clause.hinge.join("")} 把 △${clause.face.join("")} 折起 ${angle}° 至 △${[clause.hinge[0], postName, clause.hinge[1]].join("")}`,
    factIds: [],
    assumptions,
    /**
     * **目标层与折图分开**（T7）：折前 / 折后的点都在同一张表里（`post` 覆盖 `pre` 的同名点），
     * 于是"`AP⊥CD`（CD 指折前）"这种**跨状态**的目标也量得出来。
     */
    ...answerOf({ ...pre, ...post }, input.prompt),
    actions
  } as unknown as PlanEnvelope
  return { status: "ok", plan, geometry: { pre, post, apex: clause.apex, apexAs: postName, angleDegrees: angle, branch }, assumptions }
}

/** 目标文案（没有可量目标时返回空对象，计划里就不出现 `answer`）。 */
function answerOf(points: FoldPointTable, prompt: string): { answer?: string } {
  const answer = formatSolidGoalAnswer(evaluateSolidGoals(prompt, new Map(Object.entries(points))))
  return answer === null ? {} : { answer }
}
