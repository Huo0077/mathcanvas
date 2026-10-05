import { describe, expect, it } from "vitest"

import { WIRED_PROOF_BACKENDS } from "./proofArtifact"
import { isReviewPassed, PROOF_BACKEND_REVIEWS, PROOF_BACKEND_REVIEW_FIELDS, reviewProblems } from "./proofBackendReview"

/**
 * **"接上的后端恰好是这些"**（2026-10-06，N5b）—— 这份名单的**唯一一处**精确钉子。
 *
 * ## 为什么这条钉子只能有一处
 *
 * 名单是**被推导出来的**（`WIRED_PROOF_BACKENDS` = passed 记录的 `name`），所以"今天接了几个"
 * 这件事有两个观察面：**推导结果**（这里）与**记录内容**（下面那两条）。两个面都要有判据，
 * 但**字面量只能写一次** —— 写两处就会出现"两个文件各说一套、且没人知道哪一套是权威"的场面
 * （`scripts/proof-spike/smoke.test.ts` 里原来那条 `toEqual([])` 就是这样一份副本，已删）。
 *
 * ## 这条判据会怎么红（三种都要能红，否则它是别的什么）
 *
 * ① 有人往 `PROOF_BACKEND_REVIEWS` 里加第二个后端 ⇒ 白名单变了，**必须**有意识地改这里；
 * ② 有人把一条记录的 `verdict` 从 `passed` 改成别的 ⇒ 名单少一个，**接入不变量**当场红；
 * ③ 有人把名单改回手写数组（绕过推导）⇒ 与记录不再一致，红。
 *
 * 第 ③ 种由第二条用例（逐项复核记录）拦住，不是靠这一条的字面量。
 */

describe("证明后端的**接入名单**（N5b：恰好是这些，且每一个都有 passed 记录）", () => {
  it("**恰好**是 lean4 这一个 —— 逐项精确相等，不是「包含」", () => {
    // 名单第一次不再为空（此前是 `[]`：一个后端都没接）。这一行就是"我们真的接上了谁"的唯一读数。
    expect(WIRED_PROOF_BACKENDS).toEqual(["lean4"])
  })

  it("名单里的**每一个**都必须有一份十栏填齐、结论 passed 的记录（推导，不是手写）", () => {
    for (const name of WIRED_PROOF_BACKENDS) {
      const record = PROOF_BACKEND_REVIEWS.find((entry) => entry.name === name)
      expect(record, `${name} 被接上了却没有审查记录`).toBeDefined()
      // 记录必须**十栏一栏不缺**：`reviewProblems` 空 = 没有哪一栏被悄悄跳过。
      expect(reviewProblems(record), `${name} 的记录没填齐`).toEqual([])
      expect(isReviewPassed(record), `${name} 的记录结论不是 passed`).toBe(true)
    }
  })

  it("反方向：没交过记录的后端名**不在**名单里（否则「没审查就接不上」是一句空话）", () => {
    // `newclid` 是 `proofArtifact.ts` 文件头举过的例子（"另一个后端"），今天**没有**审查记录。
    // 这条断言同时是 `proofArtifact.test.ts` 那条"未接入的后端过不去"用例的**前提**：
    // 哪天有人接了 newclid，它会红 —— 那时那条用例的前提就真坏了，必须换一个未接入的名字。
    expect(WIRED_PROOF_BACKENDS).not.toContain("newclid")
    expect(PROOF_BACKEND_REVIEWS.map((entry) => entry.name)).not.toContain("newclid")
  })

  it("`lean4` 那条记录：十栏键**一个不少**，且十栏的值都不是空的", () => {
    const record = PROOF_BACKEND_REVIEWS.find((entry) => entry.name === "lean4")
    expect(record).toBeDefined()
    // 键集合逐项相等：多一栏少一栏都是契约变更，必须显式。
    expect(Object.keys(record!).sort()).toEqual([...PROOF_BACKEND_REVIEW_FIELDS].sort())
    for (const field of PROOF_BACKEND_REVIEW_FIELDS) {
      const value = (record as unknown as Record<string, unknown>)[field]
      const empty = value === undefined || value === "" || (Array.isArray(value) && value.length === 0 && field !== "nativeOrWasmDependencies")
      expect(empty, `${field} 是空的 —— 十栏不许有一栏留白（"没测"要写出来，不是留空）`).toBe(false)
    }
  })

  it("版本栏**必须逐字**等于实测的那串，不许写成 `latest` 之类的滑动值", () => {
    const record = PROOF_BACKEND_REVIEWS.find((entry) => entry.name === "lean4")
    // 证明产物的可信度挂在"哪个后端、哪个版本"上：写 `latest` 等于把一年后的另一个 lean4 也算进来。
    expect(record?.version).toContain("4.34.1")
    expect(record?.version).toContain("5045d0056413266e57c625dcd7c365b10e377c52")
  })
})
