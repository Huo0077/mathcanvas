import { describe, expect, it } from "vitest"

import { declaredProofGoal, PROOF_GOAL_KINDS, PROOF_GOAL_SUPPORT, unexpressibleFirstBatchGoals } from "./proofGoals"

/**
 * **形式证明出口声称支持哪些短目标**（N5）。
 *
 * 这张表存在的意义是**fail-closed**：只有落在表里的目标才允许升到 `formally_proved`。
 * 所以这里既要钉"表里有的能映射"，也要钉"表外的、以及**现在还表达不出来**的，
 * 不许被悄悄算成支持"。
 */
describe("形式证明的短目标词表（N5）", () => {
  it("词表与矩阵是同一份键集合（加了词表却忘了矩阵会被这条挡住）", () => {
    expect(PROOF_GOAL_SUPPORT.map((entry) => entry.kind).sort()).toEqual([...PROOF_GOAL_KINDS].sort())
    expect(new Set(PROOF_GOAL_SUPPORT.map((entry) => entry.kind)).size).toBe(PROOF_GOAL_KINDS.length)
  })

  it("首批里能表达的目标：题设种类映射到目标（含等边 → 等长）", () => {
    expect(declaredProofGoal("parallel")?.goal).toBe("parallel")
    expect(declaredProofGoal("perpendicular")?.goal).toBe("perpendicular")
    expect(declaredProofGoal("planePerpendicular")?.goal).toBe("planePerpendicular")
    expect(declaredProofGoal("equilateral")?.goal).toBe("equalLength")
    expect(declaredProofGoal("equalLength")?.goal).toBe("equalLength")
    expect(declaredProofGoal("midpoint")?.goal).toBe("midpoint")
    expect(declaredProofGoal("segmentRatio")?.goal).toBe("segmentRatio")
  })

  it("**不在首批**的目标即使能表达也不放行（二面角）", () => {
    expect(declaredProofGoal("dihedral")).toBeNull()
  })

  it("不映射到任何证明目标的题设种类要返回 null，而不是猜一个最近的", () => {
    expect(declaredProofGoal("fixedLength")).toBeNull()
    expect(declaredProofGoal("乱写的")).toBeNull()
  })

  it("计划点名、但**现在还表达不出来**的三个要如实列出来（不是悄悄当成支持）", () => {
    // 解析层的 `DiagramObligationKind` 里没有共线 / 共面 / 勾股 —— 所以照计划的话把它们
    // 列成"支持"，这张表就会变成一句没有载体的话：永远不会有 goal 被分类成它们。
    expect(unexpressibleFirstBatchGoals()).toEqual(["collinear", "coplanar", "pythagorean"])
    for (const kind of unexpressibleFirstBatchGoals()) {
      const support = PROOF_GOAL_SUPPORT.find((entry) => entry.kind === kind)
      expect(support?.inFirstBatch).toBe(true)
      expect(support?.obligationKinds).toEqual([])
    }
  })
})
