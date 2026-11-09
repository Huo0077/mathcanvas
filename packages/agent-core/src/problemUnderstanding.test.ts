import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"
import { toLegacyObligationSet } from "./obligationIR"
import { understandProblem, type ProblemUnderstanding } from "./problemUnderstanding"

/**
 * **W3 / T3：题意层要回答"原题给了什么、问了什么"，而不是"模型猜了什么"。**
 *
 * 这一组只驱动纯函数（无模型、无文档写入）。它钉住四类本轮已确认的缺陷：
 * ① 合并问句只当一问（折前 / 折后混在一起）；
 * ② ①②、(1)(2) 的小问作用域互相污染；
 * ③ 辅助点定义（垂足）被当成待证命题，或干脆丢失；
 * ④ 读不懂的条件被静默吞掉。
 *
 * 目标与条件的 `start/end` 一律是**原文的 UTF-16 下标**，所以每条断言都可以用
 * `prompt.slice(start, end) === sourceText` 复核 —— 这是"可追溯"唯一可被程序核验的形式。
 */

const REVISION = "problem-rev-1"

function understand(prompt: string, extra: Partial<Parameters<typeof understandProblem>[0]> = {}): ProblemUnderstanding {
  return understandProblem({ prompt, problemRevision: REVISION, ...extra })
}

function obligationOf(result: ProblemUnderstanding, goalId: string) {
  const obligation = result.ir.obligations.find((item) => item.id === goalId)
  expect(obligation, `目标 ${goalId} 没有对应的 IR 条目`).toBeDefined()
  return obligation!
}

describe("W3 — 合并问句拆成两个目标", () => {
  const prompt = "矩形 ABCD 中，AB=4，BC=2。沿 AC 将三角形 ABC 折起 90°，求折前BC与折后B'C的长度。"

  it("splits a merged question into two goals with different fold states", () => {
    const result = understand(prompt)

    expect(result.goals).toHaveLength(2)
    expect(result.goals.map((goal) => goal.stateId)).toEqual(["s0", "s1"])
    expect(result.goals.every((goal) => goal.expectedKind === "numeric")).toBe(true)
  })

  it("keeps every goal span traceable to the original text", () => {
    const result = understand(prompt)

    for (const goal of result.goals) {
      const obligation = obligationOf(result, goal.goalId)
      expect(prompt.slice(obligation.start, obligation.end)).toBe(obligation.sourceText)
      expect(goal.source.start).toBe(obligation.start)
      expect(goal.source.end).toBe(obligation.end)
      expect(goal.source.sourceId).toBe(REVISION)
    }
    // 两个目标的原文片段不同（不是把整句复制两遍）。
    expect(new Set(result.goals.map((goal) => goal.source.start)).size).toBe(2)
    expect(obligationOf(result, result.goals[1]!.goalId).targets).toContain("B'")
  })

  it("does not create a goal for a pre-fold-only question", () => {
    const onlyBefore = understand("矩形 ABCD 中，AB=4，BC=2。沿 AC 将三角形 ABC 折起 90°，求折前BC的长。")

    expect(onlyBefore.goals).toHaveLength(1)
    expect(onlyBefore.goals[0]?.stateId).toBe("s0")
    expect(onlyBefore.goals[0]?.dependsOnGoalIds).toEqual([])
  })
})

describe("W3 — 小问拆分与作用域隔离", () => {
  it("splits circled question numbers into separate parts", () => {
    const prompt = "已知矩形 ABCD，AB=4。①求 AB 的长；②求 CD 的长。"
    const result = understand(prompt)

    expect(result.goals).toHaveLength(2)
    expect(result.goals.map((goal) => goal.partId)).toEqual(["part-1", "part-2"])
    for (const goal of result.goals) {
      const obligation = obligationOf(result, goal.goalId)
      expect(prompt.slice(obligation.start, obligation.end)).toBe(obligation.sourceText)
    }
  })

  it("keeps a sub-question-only condition inside its own part", () => {
    const prompt = "（1）求证：AB⊥CD；（2）若AD=2，求BD的长。"
    const result = understand(prompt)

    expect(result.goals).toHaveLength(2)
    expect(result.goals.map((goal) => goal.expectedKind)).toEqual(["proof", "numeric"])

    const partTwoGoal = result.goals[1]!
    expect(partTwoGoal.partId).toBe("part-2")
    // AD=2 只在第 2 问里出现：它必须被标成第 2 问作用域，而不是公共题设。
    const ad = result.usage.find((entry) => entry.explanation.includes("AD=2") || entry.conditionSourceText === "AD=2")
    expect(ad, "AD=2 没有进入条件消费清单").toBeDefined()
    expect(ad?.partId).toBe("part-2")
    expect(ad?.requiredForGoalIds).not.toContain(result.goals[0]!.goalId)
  })
})

describe("W3 — 辅助点定义是 construction，不是待证命题", () => {
  it("reads a foot-of-perpendicular definition as a construction", () => {
    const prompt = "在矩形 ABCD 中，AB=3，BC=4。E是C在AB上的垂足。"
    const result = understand(prompt)

    const foot = result.ir.obligations.find((item) => item.role === "construction")
    expect(foot, "垂足定义没有进入题意层").toBeDefined()
    expect(foot?.kind).toBe("foot")
    expect(foot?.targets).toEqual(["E", "C", "A", "B"])
    expect(prompt.slice(foot!.start, foot!.end)).toBe(foot!.sourceText)
    // 它是题设的一部分，不是"要求证的东西"。
    expect(result.goals).toHaveLength(0)
    expect(result.ir.obligations.filter((item) => item.role === "goal")).toHaveLength(0)
  })

  it("keeps given, free choice and goal roles apart", () => {
    const prompt = "已知矩形 ABCD，AB=2。任取点 P。求证 AB⊥CD。"
    const result = understand(prompt)

    const roles = new Map(result.ir.obligations.map((item) => [item.role, [] as string[]]))
    for (const item of result.ir.obligations) roles.get(item.role)?.push(item.sourceText)

    expect(result.ir.obligations.some((item) => item.role === "given" && item.kind === "fixedLength")).toBe(true)
    expect(result.ir.obligations.some((item) => item.role === "free_choice")).toBe(true)
    const goals = result.ir.obligations.filter((item) => item.role === "goal")
    expect(goals.map((item) => item.kind)).toEqual(["perpendicular"])
    // 模型自选的坐标不属于题设：free_choice 的角色与 given 分开，谁也不冒充谁。
    expect(roles.get("goal")).toHaveLength(1)
  })
})

describe("W3 — 未读懂的条件必须保留", () => {
  it("keeps an unparsed condition in both unverified and the usage ledger", () => {
    const prompt = "已知向量 a 与 b 共线且方向相同，求 AB 的长。"
    const result = understand(prompt)

    expect(result.ir.unverified.length).toBeGreaterThan(0)
    const entry = result.usage.find((usage) => usage.disposition === "unsupported" && usage.explanation.includes("共线"))
    expect(entry, "未读懂的条件没有进入消费清单").toBeDefined()
    expect(result.goals).toHaveLength(1)
    // 关键条件未消费时，不能悄悄当它不存在。
    expect(result.usage.some((usage) => usage.disposition === "unprocessed" || usage.disposition === "unsupported")).toBe(true)
  })

  it("marks a condition nobody consumed as unprocessed instead of used", () => {
    const prompt = "矩形 ABCD 中，AB=4，BC=2。求折前BC的长。"
    const result = understand(prompt)

    const ab = result.usage.find((entry) => entry.conditionSourceText === "AB=4")
    expect(ab?.disposition).toBe("unprocessed")
    expect(ab?.consumedBy).toEqual([])
    expect(ab?.explanation).toContain("没有求解器")
  })

  it("records which solver consumed a condition when the caller reports it", () => {
    const prompt = "矩形 ABCD 中，AB=4，BC=2。求折前BC的长。"
    const result = understand(prompt)
    const ab = result.ir.obligations.find((item) => item.sourceText === "AB=4")!
    const consumed = understand(prompt, { consumed: [{ obligationId: ab.id, solver: "rectangleFold", goalIds: [result.goals[0]!.goalId] }] })

    const entry = consumed.usage.find((usage) => usage.obligationId === ab.id)
    expect(entry?.disposition).toBe("used")
    expect(entry?.consumedBy).toEqual(["rectangleFold"])
    expect(entry?.requiredForGoalIds).toEqual([result.goals[0]!.goalId])
  })
})

describe("W3 — 稳定 id 与兼容性", () => {
  it("keeps goal ids stable for the same revision, and revision-scoped otherwise", () => {
    const prompt = "矩形 ABCD 中，AB=4。求 AB 的长。"
    const first = understand(prompt)
    const again = understand(prompt)
    const otherRevision = understand(prompt, { problemRevision: "problem-rev-2" })

    expect(again.goals.map((goal) => goal.goalId)).toEqual(first.goals.map((goal) => goal.goalId))
    expect(otherRevision.goals[0]?.goalId).not.toBe(first.goals[0]?.goalId)
  })

  it("does not change the given conditions legacy verification reads", () => {
    const prompt = "矩形 ABCD 中，AB=4，BC=2。求对角线 AC 的长。"
    const result = understand(prompt)
    const parsed = parseDiagramObligations(prompt)

    expect(toLegacyObligationSet(result.ir).givens).toEqual(parsed.givens)
  })
})


it("recognizes an explicit create-one-shape request as one drawing goal", () => {
  const result = understandProblem({ prompt: "建一个棱长 3 的立方体", problemRevision: "drawing-rev" })
  expect(result.goals.map(goal => goal.expectedKind)).toEqual(["drawing"])
})

describe("single-choice exam goals", () => {
  it.each([
    "如图，三视图的正视图和俯视图已知，则侧视图可以为（）",
    "设 z=x+yi 满足 |z-i|=1，则\nA. x²+y²=1\nB. x²+(y-1)²=1\nC. x²+(y+1)²=1\nD. (x-1)²+y²=1",
    "求一个几何体的体积为( )A. 6B. 9C. 12D. 18",
    "函数图象大致为 $(\\quad)$\n请解答此题，给出必要推导，并以最终答案：X明确最终选项。"
  ])("tracks one source-bound single-choice goal: %s", (prompt) => {
    const result = understand(prompt)
    expect(result.goals).toHaveLength(1)
    const goal = result.goals[0]!
    expect(goal.expectedKind).toBe("single_choice")
    const obligation = obligationOf(result, goal.goalId)
    expect(prompt.slice(goal.source.start, goal.source.end)).toBe(obligation.sourceText)
    expect(obligation.sourceText).not.toContain("请解答此题")
  })

  it("does not downgrade an explicit drawing/proof request to an answer-only goal", () => {
    for (const prompt of ["画出函数图象，再选出正确的图形：A. 甲 B. 乙 C. 丙 D. 丁", "证明 AB=CD，A. 甲 B. 乙 C. 丙 D. 丁"]) {
      const kinds = understand(prompt).goals.map(goal => goal.expectedKind)
      expect(kinds).toContain(prompt.startsWith("画") ? "drawing" : "proof")
    }
  })

  it("does not infer a choice goal from an arbitrary mathematical assertion", () => {
    expect(understand("图中的角相等，请给出结论。").goals).toHaveLength(0)
  })
})

it("does not confuse the description of a pre-drawn three-view image with a drawing request", () => {
  const prompt = "粗线画出的是某几何体的三视图，则体积为（ ）A. 3 B. 4 C. 5 D. 6"
  expect(understand(prompt).goals.map(goal => goal.expectedKind)).toEqual(["single_choice"])
})

it("keeps an actual drawing request when it describes a provided diagram in the same question", () => {
  const prompt = "粗线画出的是三视图。请画出对应几何体，并选择正确选项（ ）A. 甲 B. 乙 C. 丙 D. 丁"
  expect(understand(prompt).goals.map(goal => goal.expectedKind)).toContain("drawing")
})
it("does not treat option labels from a statement as a standalone choice question", () => {
  expect(understand("A. AB=CD B. BC=DE C. AB=EF D. AD=BC").goals).toHaveLength(0)
})

it("does not convert a multi-part math question to one single-choice goal", () => {
  const prompt = "在三角形 ABC 中，(1) 求 AB 的长度；(2) 求面积。备选项 A. 1 B. 2 C. 3 D. 4"
  expect(understand(prompt).goals).toHaveLength(2)
  expect(understand(prompt).goals.map(goal => goal.expectedKind)).not.toEqual(["single_choice"])
})
