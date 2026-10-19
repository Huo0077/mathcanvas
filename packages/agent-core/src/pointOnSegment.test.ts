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

  /**
   * **2026-10-20 翻转**：这条原先钉的是"`AC 上一点 D` 读不出，但理由说的是「语序读不出」"。
   * 语序读取器补上之后，按它自己写明的条件翻转成"读成一条义务"（`AC 上一点 D` 的用例在
   * 下面的 describe 里）。
   */
  it("`AC 上一点 D`（点写在线段**后面**）现在读得出，不再落未核验", () => {
    const result = run("在平面内，AC 上一点 D", [...AC, point("D", { x: 1.6, y: 0 })])
    const entry = check(result)
    expect(entry.sourceText).toContain("AC 上一点 D")
    expect(entry.status, entry.reason).toBe("passed")
  })
})

/**
 * **点写在线段后面**（2026-10-20）：`AC 上一点 D`。
 *
 * 判据早就有（`pointOnSegment`：共线 + 落在线段内），缺的一直是**语序** —— 既有三条读取器
 * 都要求"点 + 是/为/在 + 线段 + 上 + 尾巴"（`D 为 AC 上一点`）或"在 + 棱/边 + 线段 + 上"，
 * 点写在线段**后面**的写法只能落未核验。卷面上这种写法很常见：
 * `AC 上一点 D`、`在线段 AC 上取一点 D`、`在 AC 上取点 D`。
 *
 * **三条反向判据一起钉住**（它们不是同一件事，读成 `pointOnSegment` 会为一句题面里
 * 没有的条件报"不满足"）：
 * - `直线 AC 上一点 D` —— 说的是**整条直线**，D 可以在延长线上；
 * - `射线 AC 上一点 D` —— 同上；
 * - `AC 的延长线上一点 D` —— 明说了在延长线上。
 */
describe("点写在线段后面：语序不再是缺口", () => {
  const onSegment = (prompt: string) =>
    parseDiagramObligations(prompt).givens.filter((item) => item.kind === "pointOnSegment").map((item) => item.targets)

  it("`AC 上一点 D` ⇒ targets [D, A, C]", () => {
    expect(onSegment("在平面内，AC 上一点 D。")).toEqual([["D", "A", "C"]])
  })

  it("`在线段 AC 上取一点 D` 与 `在 AC 上取点 D` 都读得出", () => {
    expect(onSegment("在线段 AC 上取一点 D。")).toEqual([["D", "A", "C"]])
    expect(onSegment("在 AC 上取点 D。")).toEqual([["D", "A", "C"]])
  })

  /**
   * 「线段」这个量词与「棱 / 边」是同一件事：它**已经排除了直线**，所以不必再靠
   * 「一点」那截尾巴来消歧。`点 D 在线段 AC 上` 因此也该读得出（此前只认棱 / 边）。
   */
  it("`点 D 在线段 AC 上`（带「线段」量词、没有「一点」尾巴）⇒ 读得出", () => {
    expect(onSegment("点 D 在线段 AC 上。")).toEqual([["D", "A", "C"]])
  })

  it("点落在线段外时判 `failed`（判据没变：`t ∉ [0,1]`）", () => {
    const result = run("在平面内，AC 上一点 D", [...AC, point("D", { x: 6, y: 0 })])
    expect(check(result).status).toBe("failed")
  })

  it.each(["直线 AC 上一点 D。", "射线 AC 上一点 D。", "AC 的延长线上一点 D。"])("`%s` 不读（直线 / 射线 / 延长线都不是线段）", (prompt) => {
    expect(onSegment(prompt)).toEqual([])
  })
})
