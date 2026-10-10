import type { DiagramObligation, DiagramObligationSet } from "../diagramObligations"

import type { ProofGoalKind } from "./proofGoals"

/**
 * **前提桥**（V2 GREEN 缺口②的后半）：把"命题要的前提"逐条对照**原题题面**。
 *
 * ## 为什么需要它（这条边界原来只写在注释里）
 *
 * `lean4Adapter.ts` 的文件头一直写着：**模板里的前提是"模板给的"，不是从题设消解出来的**。
 * 一句注释解决不了这件事 —— 解决它要**把每一条前提标出来源**，让"哪些来自题面、哪些是系统补的"
 * 变成机器可查的东西。这一层就是干这个的。
 *
 * ## 三类来源，缺一不可
 *
 * - **`fromText`**：这条前提**就是题面里的哪一句话**，带 `sourceText`（能指给用户看）；
 * - **`fromFigure`**：题面**没说**，但由图形自身的构造蕴含（"B、D 都是底面上的顶点" ⇒
 *   "BD 落在底面内"）。**必须列出来** —— 它确实是系统补的，不许默认掉；
 * - **`invented`**：既不在题面、也不由图形蕴含 ⇒ **凭空加前提**。
 *
 * ## fail-closed 的那一条
 *
 * **只要有一条前提是 `invented`，`ok` 就是 `false`** —— 这时不许生成命题，更不许"先证了再说"。
 * 注意它与"证不出来"是两件不同的事：那是 Lean 跑完之后的结论，这里说的是**我们连命题都还没资格生成**。
 *
 * ## 与目标消解的关系（同一个口径）
 *
 * 匹配前提时只认**已经分好读法**的题设：`perpendicular` 且点名 ≥5 才是"线⊥面"
 * （面⊥面是另一个 kind，**不在**这里）。这条口径与 `declaredProofGoalForObligation`、
 * 与 `diagramVerification` 的 `planeCount` 是同一件事。
 */

/** 一条点名线（与 `lean4Adapter` 的 `Lean4NamedLine` 结构一致；这里不 import 它，免得多一条依赖）。 */
export interface BridgedNamedLine {
  first: string
  second: string
}

/** 桥的输入：**已经分类好**的一条目标（形状与 Lean 模板的输入一一对应）。 */
export type PremiseBridgeGoal =
  | { goalKind: "perpendicular"; lineA: BridgedNamedLine; planePoints: readonly string[]; lineB: BridgedNamedLine }
  | { goalKind: "linePlanePerpendicular"; line: BridgedNamedLine; planeLines: readonly [BridgedNamedLine, BridgedNamedLine] }
  /**
   * **切线/导数那一类**（2026-10-10 加，起因是**类型门**抓到它"能生成命题却走不了这条路"）。
   *
   * 它的前提和另两类**不一样**：命题 `HasDerivAt f m x → Tendsto (slope f x) …` 是**条件命题**，
   * 那个前提（"f 在 x 处可导"）只活在命题的假设里，模板不去证明它。
   * 所以桥在这里要回答的是："题面说了这条函数可导吗？"—— 今天**没有任何句型读"可导"**，
   * 于是它如实落到 `invented`（详见 `bridgeTangentSlope`）。
   */
  | { goalKind: "tangentSlope"; tangentSlope: { functionName: string } }
  /**
   * **线在平面内**（2026-10-10 加）：两个端点在不在那个平面上。
   *
   * 它的两个前提（"这两个端点在该平面内"）**通常不会在题面里被单独说出来** —— 它们是点名的
   * 顶点结构蕴含的（与 `bridgePerpendicular` 的第二条前提同一条口径）⇒ 如实标 `fromFigure`，
   * **不是** `invented`（那会让这一类永远不可用）。
   */
  | { goalKind: "lineInPlane"; line: BridgedNamedLine; planePoints: readonly string[] }

export interface PremiseFromText {
  /** 这条前提的读法（例如 `PA ⊥ 平面 ABCD`）—— **按题面那条题设自己的点名生成**，不是按目标的点名。 */
  premise: string
  /** 题面里那一句原文（可以指给用户看）。 */
  sourceText: string
  obligationKind: string
}

export interface PremiseFromFigure {
  premise: string
  /** 为什么它算"图形蕴含"而不是"凭空编"（写给读日志的人）。 */
  reason: string
}

export interface PremiseInvented {
  premise: string
  /** 为什么它既不在题面、也不由图形蕴含。 */
  why: string
}

export interface PremiseFromDerivation {
  premise: string
  /**
   * **那一步叫什么定理**（必须点名 —— 与 `pythagorean` 的处理同一条纪律：
   * 推断要出现在证明里、看得见，不许**别名**掉）。
   */
  theorem: string
  /** 那一步的**出发点**（仍然指回题面里的一句话）。 */
  viaSourceText: string
}

export interface PremiseBridgeResult {
  goalKind: ProofGoalKind
  fromText: PremiseFromText[]
  /** 题面没**直接**说、但**一步定理**就能接出来的前提（今天只有"线⊥面 ⇒ 线⊥面内任意线"这一条路）。 */
  fromDerivation: PremiseFromDerivation[]
  fromFigure: PremiseFromFigure[]
  invented: PremiseInvented[]
  /** **每一条前提都指得出出处**才为 `true`（`invented` 非空 ⇒ `false`）。 */
  ok: boolean
}

/** 那条一步定理的**名字**（点名的，不是一句"等价"）。 */
export const PLANE_PERPENDICULAR_PROPERTY_THEOREM = "线面垂直的性质定理（线 ⊥ 面 ⇒ 它 ⊥ 平面内任意一条线）"

/** 两个点名集合是不是同一条线段（**无序**：题面写 `AB`、目标写 `BA` 是同一件事）。 */
function sameSegment(pair: readonly string[], line: BridgedNamedLine): boolean {
  const wanted = [line.first, line.second]
  if (pair.length !== 2) return false
  return pair.every((name) => wanted.includes(name))
}

function labelOfSegment(pair: readonly string[]): string {
  return `${pair[0] ?? "?"}${pair[1] ?? "?"}`
}

/** 一条"线 ⊥ 平面"题设的读法（点名 = 线 2 个 + 平面 3..6 个）。 */
function labelOfPlanePerpendicular(given: DiagramObligation): string {
  return `${labelOfSegment(given.targets.slice(0, 2))} ⊥ 平面 ${given.targets.slice(2).join("")}`
}

/** 题面里所有被点名过的点（用来判断"图形蕴含"与"凭空编"）。 */
function knownPoints(set: DiagramObligationSet, goal: PremiseBridgeGoal): Set<string> {
  const names = new Set<string>()
  for (const given of set.givens) for (const name of given.targets) names.add(name)
  for (const goalText of set.goals) for (const name of goalText.match(/[A-Z][A-Z0-9′'₁₂₃₄₅₆]*/g) ?? []) names.add(name)
  if (goal.goalKind === "perpendicular") {
    for (const name of [goal.lineA.first, goal.lineA.second, goal.lineB.first, goal.lineB.second, ...goal.planePoints]) names.add(name)
  } else if (goal.goalKind === "linePlanePerpendicular") {
    for (const name of [goal.line.first, goal.line.second, ...goal.planeLines.flatMap((line) => [line.first, line.second])]) names.add(name)
  }
  // 切线那一类**没有点名**（题目里的点是数轴上的一个数，不是图形的顶点）—— 它没有要加的名字。
  return names
}

/**
 * **把一条目标的前提逐条对照题面**（这是这一层的唯一入口）。
 *
 * 不认识的目标类 ⇒ 抛：桥**没有**"默认放行"这一支（那等于把 fail-closed 变成 fail-open）。
 */
export function bridgeProofPremises(goal: PremiseBridgeGoal, set: DiagramObligationSet): PremiseBridgeResult {
  if (goal.goalKind === "linePlanePerpendicular") return bridgeLinePlane(goal, set)
  if (goal.goalKind === "perpendicular") return bridgePerpendicular(goal, set)
  if (goal.goalKind === "lineInPlane") return bridgeLineInPlane(goal, set)
  return bridgeTangentSlope(goal, set)
}

/**
 * **切线/导数那一类的前提**（2026-10-10 加）。
 *
 * 这条命题是**条件命题**：`HasDerivAt f m x → Tendsto (slope f x) (𝓝[≠] x) (𝓝 m)`。
 * 那个前提（"`f` 在 `x` 处可导"）不在模板里被证明，所以桥要回答的是：
 * **题面说了这条函数可导吗？**
 *
 * ## 今天答案几乎总是"没有"，而这**不是** bug
 *
 * 解析层的句型表里**没有任何一条读"可导"**（题面通常只说"已知函数 `f(x)=x³−3x`"）。
 * "多项式处处可导"是**数学事实**，但它**不在题面里**、也**还没被形式化**（要在 Lean 里算出
 * 那条多项式的导数，得另做一层）。所以这里**如实落到 `invented`** ⇒ `ok:false` ⇒
 * 产品链路**不会**去调 Lean。
 *
 * **这正是这套判据该有的样子**：类有了、模板真跑通了（`DrawProof.lean` 里那条一般命题），
 * 但**这道题的前提没有被题面说出来** —— 系统不许替它补一条。
 */
/**
 * **线在平面内**：两个前提是"两个端点都在那个平面上"。题面通常不会单独写这句话 ——
 * 它由点名结构蕴含（这两个点都是题面点名造出来的顶点）⇒ 如实标 `fromFigure` 并说明理由。
 */
function bridgeLineInPlane(goal: Extract<PremiseBridgeGoal, { goalKind: "lineInPlane" }>, set: DiagramObligationSet): PremiseBridgeResult {
  const known = knownPoints(set, goal)
  const plane = goal.planePoints.join("")
  const endpoints = [goal.line.first, goal.line.second]
  const fromFigure: PremiseFromFigure[] = []
  const invented: PremiseInvented[] = []
  for (const endpoint of endpoints) {
    const premise = `${endpoint} 落在平面 ${plane} 内`
    if (goal.planePoints.includes(endpoint)) {
      fromFigure.push({ premise, reason: "这个点就在题面给的平面点表里 —— 点名结构直接蕴含。" })
    } else if (known.has(endpoint)) {
      fromFigure.push({ premise, reason: "题面没有单独说这句话；它由图形自身的构造蕴含（这个点是题面点名造出来的顶点）。**这是系统补的前提，如实列出来。**" })
    } else {
      invented.push({ premise, why: "这个点根本不在题面点名的点集里。" })
    }
  }
  return { goalKind: goal.goalKind, fromText: [], fromDerivation: [], fromFigure, invented, ok: invented.length === 0 }
}

function bridgeTangentSlope(goal: Extract<PremiseBridgeGoal, { goalKind: "tangentSlope" }>, set: DiagramObligationSet): PremiseBridgeResult {
  void set
  const invented: PremiseInvented[] = [{
    premise: `${goal.tangentSlope.functionName} 可导`,
    why: "题面没有说这条函数可导，而它是这条命题**唯一**的前提（命题是条件命题：可导 ⇒ 割线斜率趋于导数）。「多项式处处可导」是数学事实，但它不在题面里、也还没被形式化 —— 系统不许替题面补一条它没说的。"
  }]
  /**
   * **为什么这里没有"去题设里找'可导'"的那一支**（2026-10-10 实测后删掉的）：
   * 解析层的句型表**没有任何一条读"可导"**，所以那种句子会整句落进 `unverified`
   *（不是 `givens`）。写一支"找得到就用"的代码，今天**永远走不到**，却会让读代码的人以为
   * "题面写了可导就能走通"。**这里如实是"一律没有出处"**；哪天解析层真的有了那样的句型，
   * 这一支再连到 `fromText` 上（那时它才有东西可指）。
   */
  return { goalKind: goal.goalKind, fromText: [], fromDerivation: [], fromFigure: [], invented, ok: false }
}

/** 判定定理：两个前提都是"那条线 ⊥ 平面内的一条线"；先找**直接给的**，再找**一步导出的**。 */
function bridgeLinePlane(goal: Extract<PremiseBridgeGoal, { goalKind: "linePlanePerpendicular" }>, set: DiagramObligationSet): PremiseBridgeResult {
  const premises = [goal.planeLines[0], goal.planeLines[1]]
  const fromText: PremiseFromText[] = []
  const fromDerivation: PremiseFromDerivation[] = []
  const invented: PremiseInvented[] = []

  /**
   * **一步定理**：题面给的是"那条线 ⊥ **整个平面**"时，"它 ⊥ 平面内任意一条线"是**性质定理**那一步。
   * 这条与 `lean4Adapter` 的第一个目标类（`perpendicular`）**是同一个定理** ——
   * 所以这里不是新发明一条推断，而是把已有那个目标类**当成一步用**。
   * 只认点名 ≥5 的那种读法（面⊥面是另一个 kind，不算）。
   */
  const propertySource = set.givens.find((given) => {
    if (given.kind !== "perpendicular" || given.targets.length < 5) return false
    return sameSegment(given.targets.slice(0, 2), goal.line)
  })
  const propertyPlaneNames = propertySource === undefined ? [] : propertySource.targets.slice(2)

  for (const planeLine of premises) {
    const hit = set.givens.find((given) => {
      if (given.kind !== "perpendicular" || given.targets.length !== 4) return false
      const first = given.targets.slice(0, 2)
      const second = given.targets.slice(2)
      // **方向可以反过来**：题面写 `AB ⊥ PA`、目标写 `PA ⊥ AB` 是同一件事。
      return (sameSegment(first, goal.line) && sameSegment(second, planeLine)) || (sameSegment(first, planeLine) && sameSegment(second, goal.line))
    })

    if (hit !== undefined) {
      fromText.push({ premise: `${labelOfSegment(hit.targets.slice(0, 2))} ⊥ ${labelOfSegment(hit.targets.slice(2))}`, sourceText: hit.sourceText, obligationKind: hit.kind })
      continue
    }

    // 直接给的没找到 ⇒ 看能不能由"线 ⊥ 整个平面"那一步接出来（平面里必须**真的**有这两条线的端点）。
    const derivable = propertySource !== undefined && [planeLine.first, planeLine.second].every((point) => propertyPlaneNames.includes(point))
    if (derivable) {
      fromDerivation.push({
        premise: `${labelOfSegment([goal.line.first, goal.line.second])} ⊥ ${labelOfSegment([planeLine.first, planeLine.second])}`,
        theorem: PLANE_PERPENDICULAR_PROPERTY_THEOREM,
        viaSourceText: propertySource!.sourceText
      })
      continue
    }

    invented.push({
      premise: `${labelOfSegment([goal.line.first, goal.line.second])} ⊥ ${labelOfSegment([planeLine.first, planeLine.second])}`,
      why: "题面里没有这一条垂直，也不能由「线 ⊥ 面」那一步接出来（判定定理的两个前提必须**有着落**：要么题面直接给，要么由那个平面上的题设一步导出）。"
    })
  }

  return { goalKind: goal.goalKind, fromText, fromDerivation, fromFigure: [], invented, ok: invented.length === 0 }
}

/** 性质定理：前提一是"线 ⊥ 面"（要在题面里找得到），前提二是"目标线落在那个平面内"（题面一般不会写）。 */
function bridgePerpendicular(goal: Extract<PremiseBridgeGoal, { goalKind: "perpendicular" }>, set: DiagramObligationSet): PremiseBridgeResult {
  const fromText: PremiseFromText[] = []
  const fromFigure: PremiseFromFigure[] = []
  const invented: PremiseInvented[] = []
  const known = knownPoints(set, goal)

  // 前提一：线 ⊥ 面 —— 只认"线 ⊥ 面"那一种读法（`perpendicular` 且点名 ≥ 5）。
  const planeGiven = set.givens.find((given) => {
    if (given.kind !== "perpendicular" || given.targets.length < 5) return false
    if (!sameSegment(given.targets.slice(0, 2), goal.lineA)) return false
    const planeNames = given.targets.slice(2)
    return goal.planePoints.length >= 3 && goal.planePoints.every((point) => planeNames.includes(point))
  })

  if (planeGiven !== undefined) {
    fromText.push({ premise: labelOfPlanePerpendicular(planeGiven), sourceText: planeGiven.sourceText, obligationKind: planeGiven.kind })
  } else {
    invented.push({
      premise: `${labelOfSegment([goal.lineA.first, goal.lineA.second])} ⊥ 平面 ${goal.planePoints.join("")}`,
      why: "题面里没有这条「线 ⊥ 面」的题设，而它是这条性质定理**唯一**的前提 —— 系统不许替题面补一条。"
    })
  }

  // 前提二：目标线的两个端点都落在那个平面上。题面**通常不会**单独写这句话（它是图形结构）。
  const planeNames = planeGiven === undefined ? [...goal.planePoints] : planeGiven.targets.slice(2)
  const endpoints = [goal.lineB.first, goal.lineB.second]
  const label = `${labelOfSegment(endpoints)} 落在平面 ${planeNames.join("")} 内`
  if (endpoints.every((point) => planeNames.includes(point))) {
    // 两个端点都在平面点名里 ⇒ 这条其实是**题面点名结构**直接给的（例如平面四点环）。
    fromFigure.push({ premise: label, reason: "两个端点都出现在题面给的平面点表里，所以「落在这个平面上」是点名结构直接蕴含的（题面没有再说一遍）。" })
  } else if (endpoints.every((point) => known.has(point))) {
    fromFigure.push({
      premise: label,
      reason: "题面没有单独说这句话；它由图形自身的构造蕴含（这些点都是题面点名造出来的顶点）。**这是系统补的前提，必须如实列出来。**"
    })
  } else {
    invented.push({ premise: label, why: "有端点根本不在题面点名的点集里 —— 那说明这条线的位置是凭空来的。" })
  }

  return { goalKind: goal.goalKind, fromText, fromDerivation: [], fromFigure, invented, ok: invented.length === 0 }
}
