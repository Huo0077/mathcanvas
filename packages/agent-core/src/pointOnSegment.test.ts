import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

/**
 * **「点在一条线段上」的判据**（2026-10-15 用户现场，Rt△ABC 折起那道题）。
 *
 * ## 为什么要有这一条
 *
 * `D 为 AC 上一点` 此前**只有触发词、没有判据** ⇒ 落"未核验"，用户看到的是"今天还没有判据"。
 * 而它是**量得动**的：① 与这条直线**共线**、② 落在**线段内**（参数 `t ∈ [0,1]`）。
 *
 * ## 关键判据：两种错法必须分开说
 *
 * 这不是洁癖 —— 它们**不是同一种错**：
 * - `D 根本不在 AC 这条线上`（到直线的距离 ≠ 0）⇒ 该改的是 D 的位置或那条线；
 * - `D 在 AC 的延长线上`（共线但 `t ∉ [0,1]`）⇒ 该改的是参数。
 *
 * 题面写 `AC 上一点`，而"`AC` 的延长线上一点"是**另一件事** —— 说成同一句，用户不知道该改哪里。
 *
 * ## 用例的口径
 *
 * 期望值一律**测试自己算**（把点代进 `t = (D−A)·(C−A)/|AC|²`），不读被测判据的自报数。
 */
const PROMPT = "在平面内，点 D 为 AC 上一点"

const A = { x: 0, y: 0 }
const C = { x: 4, y: 0 }

const point = (name: string, position: { x: number; y: number }) =>
  ({ actionId: "planar.create_point", actionKey: name, factIds: [], inputs: { alias: name, points: [position], label: name } })
const segment = (label: string) =>
  ({ actionId: "planar.create_segment", actionKey: label, factIds: [], inputs: { alias: label, points: [A, C], label } })

const AC = [point("A", A), point("C", C), segment("AC")]

function run(prompt: string, actions: readonly unknown[]) {
  const plan = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "点在线上", factIds: [], actions } as unknown as PlanEnvelope
  return compilePlan(plan, { document: createEmptyDocument("conics"), prompt, conversationId: "point-on-segment", documentGeneration: 0 })
}

/** 报告里那一条 `pointOnSegment`，附带上"为什么"（读不出报告时把诊断带出来）。 */
function check(result: ReturnType<typeof run>) {
  const why = result.diagramVerification === undefined
    ? `没有核验报告；诊断：${result.diagnostics.map((entry) => `${entry.stage}/${entry.code}@${entry.path}: ${entry.detail}`).join("；")}`
    : result.diagramVerification.checks.map((entry) => `${entry.sourceText}:${entry.status}`).join("；")
  const found = result.diagramVerification?.checks.find((entry) => entry.kind === "pointOnSegment")
  expect(found, why).toBeDefined()
  return found!
}

describe("点在线段上：共线 + 落在线段内，两种错法分开说", () => {
  it("`D` 真的落在线段内 ⇒ `passed`（参数由测试自己算：0.4）", () => {
    const D = { x: 1.6, y: 0 }
    const result = run(PROMPT, [...AC, point("D", D)])
    const entry = check(result)

    // 测试自己算参数（不读判据自报数）。
    const t = ((D.x - A.x) * (C.x - A.x) + (D.y - A.y) * (C.y - A.y)) / ((C.x - A.x) ** 2 + (C.y - A.y) ** 2)
    expect(t).toBeCloseTo(0.4, 12)
    expect(entry.status, entry.reason).toBe("passed")
    expect(result.diagramVerification?.status, entry.reason).toBe("passed")
    expect(entry.reason, entry.reason).toContain("t=0.4")
  })

  it("共线但**在延长线上** ⇒ `failed`，理由说的是「延长线」而不是「不在线上」", () => {
    const D = { x: 6, y: 0 }
    const result = run(PROMPT, [...AC, point("D", D)])
    const entry = check(result)

    const t = (D.x - A.x) / (C.x - A.x)
    expect(t).toBeCloseTo(1.5, 12)
    expect(entry.status, entry.reason).toBe("failed")
    expect(entry.reason, entry.reason).toContain("延长线")
    // **不是**「根本不在线上」那一句 —— 两种错法不许混成一句。
    expect(entry.reason, entry.reason).not.toContain("根本不在")
  })

  it("**根本不在 `AC` 这条线上** ⇒ `failed`，理由是共线那一句（不是「延长线」）", () => {
    const D = { x: 1.6, y: 1.2 }
    const result = run(PROMPT, [...AC, point("D", D)])
    const entry = check(result)

    // 测试自己算"到直线的距离"：D 的 y 就是 1.2（AC 是 x 轴）。
    expect(Math.abs(D.y)).toBeCloseTo(1.2, 12)
    expect(entry.status, entry.reason).toBe("failed")
    expect(entry.reason, entry.reason).toContain("根本不在")
    expect(entry.reason, entry.reason).not.toContain("延长线")
  })

  it("图上没有 `D` ⇒ `unverified`（理由点名缺失），**不硬凑一个点**", () => {
    const result = run(PROMPT, AC)
    const entry = check(result)

    expect(entry.status, entry.reason).toBe("unverified")
    expect(entry.reason, entry.reason).toContain("D")
  })
})

describe("读取器的边界（如实记着，不许静默）", () => {
  it("`点 D 为 AC 上一点` 读成 `pointOnSegment`：`targets` = [点, 线段两端]", () => {
    const parsed = parseDiagramObligations(PROMPT)
    const onSegment = parsed.givens.filter((item) => item.kind === "pointOnSegment")
    expect(onSegment.map((item) => item.targets)).toEqual([["D", "A", "C"]])
    expect(parsed.unverified.map((entry) => entry.sourceText).join("｜")).not.toContain("AC 上一点")
  })

  /**
   * **光写"在 `AC` 上"不收**：那既可能是线段、也可能是直线 —— 猜不得。
   * 它落"未核验"，而且理由里明说"点名没排成能读的顺序"（判据其实已经有了）。
   */
  it("`点 D 在 AC 上`（没有「一点」那截尾巴）⇒ 不读，如实未核验", () => {
    const parsed = parseDiagramObligations("在平面内，点 D 在 AC 上")
    expect(parsed.givens.filter((item) => item.kind === "pointOnSegment")).toEqual([])
  })

  it("`AC 上一点 D`（点写在线段**后面**）⇒ 读不出，但理由说的是「语序读不出」而不是「没有判据」", () => {
    const result = run("在平面内，AC 上一点 D，且 AB=2", [...AC, point("D", { x: 1.6, y: 0 })])
    const reasons = (result.diagramVerification?.checks ?? []).map((entry) => entry.reason).join("｜")
    expect(reasons, reasons).toContain("点名没排成能读的顺序")
    expect(reasons, reasons).not.toContain("今天**还没有判据**")
  })
})
