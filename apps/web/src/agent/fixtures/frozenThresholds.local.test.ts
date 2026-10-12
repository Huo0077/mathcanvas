import { examCaseFor, FROZEN_THRESHOLDS, frozenCaseIds, frozenSample } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { matchLocalIntent } from "../localPlanner"

/**
 * **Task 20 的"离线能拆到哪一层"**（计划：`先离线拆出 plan/schema/构造/核验/可读性的失败分布`）。
 *
 * ## 为什么这一条要在 apps/web 里
 *
 * "离线能不能碰某一道真题"这件事的**唯一真源**是本地规划器的匹配表（`matchLocalIntent`）。
 * 把结论抄成一份常量（`frozenThresholds.ts` 的 `offlineAttemptability`）就多了一份会腐烂的
 * 判据 —— 所以那一栏由**这条用例逐条核对**：写错就红，加了夹具也会红（那时该改标注，
 * 而不是改这条用例）。
 *
 * ## 离线能拆到哪一层（实测）
 *
 * 计划点名的五层是 plan / schema / 构造 / 核验 / 可读性。**后面四层都要求先有 plan** ——
 * 规划层不出东西，其余四层**一条读数都没有**（不是"通过"，是"无从谈起"）。所以离线分布
 * 的形状是：先数"多少条题面离线规划得出来"，剩下的如实记成"要真实 provider"。
 *
 * 这一条**不调用任何 provider**（本地规划器是纯函数），它就是给 Task 20 的授权请求提供分母：
 * 需要多少请求 = 需要用 provider 的题数 × `trialsPerCase`。
 */
describe("Task 20: 离线失败分布只到 planning 层", () => {
  const rows = frozenCaseIds().map((id) => {
    const examCase = examCaseFor(id)!
    return { id, family: examCase.family, prompt: examCase.prompt, matched: matchLocalIntent(examCase.prompt) !== null }
  })

  it("**每一条冻结样本的离线可跑性都与真实匹配器一致**（标注写错就红）", () => {
    for (const row of rows) {
      const sample = frozenSample(row.id)
      expect(sample, `${row.id} 没有冻结样本`).not.toBeNull()
      const claimed = sample!.offlineAttemptability === "local-fixture"
      expect(
        row.matched,
        `${row.id}（${row.family}）实测 matchLocalIntent=${row.matched}，而冻结表标的是 ${sample!.offlineAttemptability} —— 两者必须一致（加了夹具就改标注，不要改这条用例）`
      ).toBe(claimed)
    }
  })

  it("**离线读数不等于这道题被跑通**：12/12 都要 provider 才判得了", () => {
    const answeredLocally = rows.filter((row) => row.matched)
    /**
     * 这一轮实测：**只有一条**真题题面会被本地规划器接走 —— 2023 新课标Ⅰ卷 18
     *（`正四棱柱中多条棱上的点构成的空间关系。` 命中棱柱夹具）。而它给的图是**夹具那只正棱柱**，
     * 不是这道题；这条用例自己的 `requiredFigure` 恰好写着"不能用假定立方体遮蔽原题条件"。
     * 所以它**同样**要真实 provider 才能判 —— "离线有回应"与"这道题跑通了"是两件事。
     */
    expect(answeredLocally.map((row) => row.id)).toEqual(["exam-solid-2023-new-curriculum-i-18"])
    expect(rows).toHaveLength(frozenCaseIds().length)

    // 分布按族摊开（这是给授权请求用的分母：请求数 = 题数 × trialsPerCase，**全部题**都要 provider）。
    const perFamily = FROZEN_THRESHOLDS.families.map((entry) => {
      const familyRows = rows.filter((row) => row.family === entry.family)
      return `${entry.family}: 本地有回应 ${familyRows.filter((row) => row.matched).length}/${familyRows.length}（都仍需 provider 判定）`
    })
    console.log(`OFFLINE-DISTRIBUTION ${JSON.stringify({ perFamily, trialsPerCase: FROZEN_THRESHOLDS.trialsPerCase, requestsIfAuthorized: rows.length * FROZEN_THRESHOLDS.trialsPerCase })}`)
  })
})
