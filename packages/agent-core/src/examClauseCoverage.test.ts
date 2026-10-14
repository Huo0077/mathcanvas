import { describe, expect, it } from "vitest"

import { EXAM_CASES, HELD_OUT_CASES } from "./benchmark/examSet"
import { parseDiagramObligations } from "./diagramObligations"

/**
 * **题面审计：带具体条件的句子，要么读出来、要么如实说"未核验"**（2026-10-14）。
 *
 * ## 为什么要有这一条
 *
 * 它不是为某一道题写的，是为**一类缺陷**写的 —— 本仓已经撞过两次：
 *
 * - `弦 AB 的长为 3`（Task 14 的边界）：两条读取器都不认它，而那句里**没有 `=`**，
 *   残留扫描器的触发词也够不到它 ⇒ 条件**静默消失**（既不进 `givens`、也不进 `unverified`）；
 * - 非标准曲线：它**进了** `unverified`，但理由把"范围外"说成了"没写清楚"（同一族的另一种形态）。
 *
 * 判据一句话：**带具体条件的句子必须出现在 `givens` 或 `unverified` 里**。落进 `unverified`
 * 是可以的（"读不懂就如实说"）；**消失不行**。
 *
 * ## 分母为什么分两段（这是本轮量出来的）
 *
 * 随仓的 12 道"真题题面"**全是调研归纳的转述**（`promptKind: "survey-summary"`，
 * `verifiedGoldCaseIds` 至今为空）—— 像「椭圆动弦。」「两条曲线的公切线。」这样的**主题摘要**，
 * 它们**不带任何具体条件**。拿"每句都要被记账"去卡它们，只会得到一堆假红：
 * 摘要本来就没有"读得出/读不出"这回事。所以判据收成两段：
 *
 * 1. **摘要那一批**：只卡"**带具体条件**（既有条件词、又有数字）的句子"——今天一条都没有，
 *    于是它是一道**等真题题面进仓才会咬人**的护栏（计划要的 `verbatim` 题面一旦有了，
 *    这一条立刻开始工作）；
 * 2. **具体句子那一批**：拿仓库里真实用过的**问题句**（用户原话、各任务夹具里的题面）
 *    逐句卡同一件事 —— 这一批今天就会咬人（`弦 AB 的长为 3` 就是在这里被抓出来的）。
 */
const CONDITION_WORDS = /[=⊥∥:：]|∠|中点|面积|交点|所成角|弦|切线|平行|垂直|相等|比例|之比|距离/
/** **带具体条件**：既有条件词、又有数字（摘要里两样都缺）。 */
const concrete = (clause: string): boolean => CONDITION_WORDS.test(clause) && /\d/.test(clause)

function clauses(prompt: string): string[] {
  return [...prompt.matchAll(/[^，,。；;\n]+/g)].map((match) => match[0].trim()).filter((clause) => clause.length > 0)
}

function vanishedClauses(prompt: string): string[] {
  const parsed = parseDiagramObligations(prompt)
  const accounted = [...parsed.givens.map((item) => item.sourceText), ...parsed.unverified.map((item) => item.sourceText)]
  return clauses(prompt).filter((clause) => concrete(clause) && !accounted.some((text) => clause.includes(text) || text.includes(clause)))
}

/** 仓库里真实用过的问题句（用户原话 + 各任务夹具的题面）。 */
const CONCRETE_SENTENCES = [
  "平面三角形ABC中，AB=8，∠BAC=30°，△ABC的面积为6",
  "椭圆 x²/9+y²/4=1 与直线 y=x+1 相交于 A、B 两点，弦 AB 的长为 3",
  "椭圆 x²/9+y²/4=1 与直线 y=0.5 相交于 A、B 两点，|AB|=3",
  // 「**长度**是」那一支是审计自己照出来的（只收"长为"时它会静默消失），已于 2026-10-15 收进读取器。
  "椭圆 x²/9+y²/4=1 与直线 y=0.5 相交于 A、B 两点，弦 AB 的长度是 3",
  "直线 y=0.5 与 f(x)=sin x 的图像有三个交点",
  "平面三角形ABC中，∠A=30°，AB=8，BC=4",
  "在斜三棱柱ABC-A′B′C′中，AB=2，AA′与底面所成角为45°",
  "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3",
  "在四棱锥P-ABCD中，PA⊥平面ABCD，AB⊥AD，二面角P-CD-A=45°"
]

describe("题面审计 —— 带具体条件的句子不许静默消失", () => {
  /**
   * **先证明这条审计真会咬人**（本仓对"新判据"的一贯要求：跑绿不算数，得能看到它红）。
   *
   * 喂一句**有条件词、有数字、但任何读取器都不认**、而且残留扫描器的触发词也够不到的话
   *（`弦 AB 大约 3`：没有 `=`、没有"相等/中点/面积/交点"那些词）—— 它**必须**被报出来。
   * 没有这一条，上面那些全绿说明不了任何事：可能是我把判据写成了恒真。
   */
  it("对照组：一句真会被丢掉的话（`弦 AB 大约 3`）必须被报出来", () => {
    const sentence = "椭圆 x²/9+y²/4=1 与直线 y=0.5 相交于 A、B 两点，弦 AB 大约 3"
    expect(vanishedClauses(sentence)).toEqual(["弦 AB 大约 3"])
  })

  for (const sentence of CONCRETE_SENTENCES) {
    it(`具体句：${sentence}`, () => {
      const vanished = vanishedClauses(sentence)
      expect(vanished, `这些带具体条件的句子既没被读出来、也没落进未核验：${vanished.join(" ／ ")}`).toEqual([])
    })
  }

  for (const examCase of [...EXAM_CASES, ...HELD_OUT_CASES]) {
    it(`随仓题面（摘要）：${examCase.id}`, () => {
      const vanished = vanishedClauses(examCase.prompt)
      expect(vanished, `题面：${examCase.prompt}\n这些带具体条件的句子消失了：${vanished.join(" ／ ")}`).toEqual([])
    })
  }
})
