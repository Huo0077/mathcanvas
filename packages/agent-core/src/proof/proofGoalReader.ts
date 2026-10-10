import type { DiagramObligationSet } from "../diagramObligations"
import { recognizeObligationText } from "../obligationIR"

import type { PremiseBridgeGoal } from "./proofPremiseBridge"

/**
 * **题面的目标句 → 结构化的证明目标**（V2 GREEN 缺口③ 的最后一块拼图）。
 *
 * ## 为什么需要它
 *
 * 没有它，"产品自动调用"就不知道**要证什么**：题面里那句话是自然语言
 *（"求证 PA ⊥ 平面 ABC"），而适配器要的是 `{ goalKind, line, planeLines }` 这种形状。
 *
 * ## 这里**不新写解析器**（这一条是本仓反复强调的纪律）
 *
 * `obligationIR.ts` 早就把"求证"那一句送进**题设那张句型表**（`recognizeObligationText`）——
 * 一张表认题设与目标两处，本来就有的性质。这一层只做那之后的四件事：
 *
 * 1. 用**按点名形状**的消解（`declaredProofGoalForObligation`，与题设那侧同一口径）判这目标属于哪一类；
 * 2. 把这一类需要的字段**从这句话与题设里读出来**（哪条线、哪个平面、函数叫什么）；
 * 3. **把系统替用户做的选择列出来**（`choices`，R51 的纪律：系统替你选了哪些值，用户确认前要看得见）；
 * 4. 读不出结构 ⇒ `ok:false` + 一句人能读的理由。**绝不允许"猜一个最近的类"** ——
 *    那会让系统去证一条**别的**命题（这正是本项目最危险的失效方式）。
 */

export interface ProofGoalReading {
  goal: PremiseBridgeGoal
  /** 那句目标原话（后面进 claim 的来源栏）。 */
  sourceText: string
  /**
   * **系统替用户做的选择**（按 R51：必须能列给用户看）。例如
   * "判定定理要平面内两条相交直线，系统取了 `AB` 与 `AC`" —— 换了另一对也是对的，
   * 但用户有权知道是哪一对被用了。
   */
  choices: string[]
}

export type ReadProofGoalResult = { ok: true; reading: ProofGoalReading } | { ok: false; reason: string }

function refused(reason: string): ReadProofGoalResult {
  return { ok: false, reason }
}

/** 点名线的读法（与适配器的 `Lean4NamedLine` 结构一致）。 */
function pair(targets: readonly string[]): { first: string; second: string } {
  return { first: targets[0] as string, second: targets[1] as string }
}

/** 两个点名集合是不是同一条线（**无序**：`PA` 与 `AP` 是同一件事）。 */
function sameLine(a: { first: string; second: string }, b: readonly string[]): boolean {
  return b.length === 2 && [a.first, a.second].every((name) => b.includes(name))
}

/**
 * 题面里那条函数的**名字**。
 *
 * 找的地方按可靠程度排：① 题设里那条"函数定义"（`functionGraph`）；② **没被解析成题设的原句**
 *（`unverified` 里留着题面原文 —— 实测：解析器的函数定义句型**只认 `f(x)=…`**，
 *  `g(x)=…` 会整句落进 `unverified`）；③ 目标句自己。都取不到才退回 `f`，并如实说这是系统选的。
 *
 * **为什么这个名字值得较真**：它**进命题**（`{f : ℝ → ℝ}` 那个变量名），所以它是"命题与这道题"
 * 之间唯一的一根可见的线（横坐标与具体曲线都不进命题）。退回了就说退回了，不假装是从题面读的。
 */
function functionNameOf(set: DiagramObligationSet, goalText: string): { name: string; choice: string } {
  const candidates: { text: string; where: string }[] = [
    ...set.givens.filter((given) => given.kind === "functionGraph").map((given) => ({ text: given.sourceText, where: "题面那条函数定义" })),
    ...set.unverified.map((entry) => ({ text: entry.sourceText, where: "题面里那句还没被解析成题设的原话" })),
    { text: goalText, where: "目标句自己" }
  ]
  for (const candidate of candidates) {
    const matched = candidate.text.match(/([A-Za-z])\s*\(\s*x\s*\)/)
    if (matched?.[1] !== undefined) return { name: matched[1], choice: `命题里的函数变量叫 \`${matched[1]}\` —— 取自${candidate.where}。` }
  }
  return { name: "f", choice: "题面里找不到可读的函数名，系统把命题里的函数变量命名为 `f`（它只是个变量名，不进结论的数学内容）。" }
}

/**
 * **读一句目标**（这是这一层的唯一入口）。
 *
 * 输出要么能被 `bridgeProofPremises` 直接吃下（前提桥会再判一次"每条前提指不指出处"），
 * 要么就是一句**为什么读不出**。
 */
export function readProofGoal(goalText: string, set: DiagramObligationSet): ReadProofGoalResult {
  const recognized = recognizeObligationText(goalText)
  if (recognized === null) {
    return refused(`这句目标认不出是哪一类几何断言（句型表里没有它）：「${goalText.trim()}」—— 不猜一个最近的类。`)
  }
  const targets = [...recognized.targets]

  if (recognized.kind === "planePerpendicular") {
    // **面⊥面 与 线⊥面 不是一回事**（这一点是同一批工作里查实并修掉的错配）。
    return refused(`这句目标说的是「平面 ⊥ 平面」，而证明出口今天**没有**这一类的模板（面⊥面与线⊥面不是一回事，不许混）。`)
  }

  if (recognized.kind === "perpendicular" && targets.length >= 5) {
    // 「线 ⊥ 面」：点名 = 线 2 个 + 平面 3..6 个。
    const line = pair(targets)
    const planePoints = targets.slice(2)
    /**
     * 判定定理要**平面内两条相交直线**。系统取"第一个点 + 第二个点"与"第一个点 + 第三个点"
     * —— 两条线共用第一个点，所以它们相交。**换了另一对也是对的**，所以这是一个**选择**，
     * 必须列出来（R51），而不是悄悄替用户定下。
     */
    const planeLines: [{ first: string; second: string }, { first: string; second: string }] = [
      { first: planePoints[0] as string, second: planePoints[1] as string },
      { first: planePoints[0] as string, second: planePoints[2] as string }
    ]
    return {
      ok: true,
      reading: {
        sourceText: goalText.trim(),
        goal: { goalKind: "linePlanePerpendicular", line, planeLines },
        choices: [
          `判定定理要平面内两条相交直线，系统取了 \`${planeLines[0].first}${planeLines[0].second}\` 与 \`${planeLines[1].first}${planeLines[1].second}\`（换另一对同样成立）。`
        ]
      }
    }
  }

  if (recognized.kind === "perpendicular" && targets.length === 4) {
    // 「线 ⊥ 线」：起点是**性质定理**（线 ⊥ 面 ⇒ 线 ⊥ 面内任意线），所以那个平面必须从题设里找。
    const lineA = pair(targets.slice(0, 2))
    const lineB = pair(targets.slice(2))
    const planeGivens = set.givens.filter((given) => given.kind === "perpendicular" && given.targets.length >= 5)
    const forA = planeGivens.find((given) => sameLine(lineA, given.targets.slice(0, 2)))
    // 目标写反（`BD ⊥ PA`）时，挂在"⊥面"那条线上的可能是**另一条**：那样就把它对调过来。
    const forB = forA === undefined ? planeGivens.find((given) => sameLine(lineB, given.targets.slice(0, 2))) : undefined
    const source = forA ?? forB
    if (source === undefined) {
      return refused(
        `这条目标要用「线 ⊥ 面 ⇒ 它 ⊥ 平面内任意一条线」那一步，但题面里找不到 \`${lineA.first}${lineA.second}\`（或 \`${lineB.first}${lineB.second}\`）⊥ 哪个平面的题设 —— 那个平面是这条命题的前提，系统不许替题面编一个。`
      )
    }
    const planePoints = source.targets.slice(2)
    const choices: string[] = [`平面取自题面那条题设「${source.sourceText}」。`]
    const swapped = forA === undefined
    if (swapped) choices.push(`题面把这条线写成了 \`${lineB.first}${lineB.second} ⊥ ${lineA.first}${lineA.second}\`：结论对称，系统**对调**了这两条线，让前提挂在「⊥面」的那一条上。`)
    return {
      ok: true,
      reading: {
        sourceText: goalText.trim(),
        goal: {
          goalKind: "perpendicular",
          lineA: swapped ? lineB : lineA,
          planePoints,
          lineB: swapped ? lineA : lineB
        },
        choices
      }
    }
  }

  if (recognized.kind === "tangentAt") {
    const named = functionNameOf(set, goalText)
    return {
      ok: true,
      reading: {
        sourceText: goalText.trim(),
        goal: { goalKind: "tangentSlope", tangentSlope: { functionName: named.name } },
        choices: [
          named.choice,
          // 题面点名的那个横坐标**不进命题**（命题关于任意 x），这一点也要说出来，
          // 免得用户以为"凭证绑在 x=1 上"。
          "题面那个横坐标不进命题（命题关于任意 x；它属于题面，绑定靠这条 claim 的原文）。"
        ].filter((line) => line.length > 0)
      }
    }
  }

  return refused(`这句目标认出来了（题设种类 = \`${recognized.kind}\`），但证明出口今天没有这一类的模板 —— 如实停在原地。`)
}
