import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **「点在圆锥曲线上」的判据**（施工单①，2026-10-15）。
 *
 * ## 为什么要有这一条
 *
 * `P 是椭圆上任意一点` 此前**整句消失**：既不进给定、也不进未核验 —— 与当年那条
 * `弦 AB 的长为 3` 是同一种病。它既让用户看不见这条题设，也让"图上那个 P 到底在不在椭圆上"
 * 从来没人问过（图上把 P 画在椭圆里面，报告照样全绿）。
 *
 * ## 判据只有一处
 *
 * 残差由内核的 `conicResidualAt` 给（`conic-line.ts` 里已有的那套：局部隐式形式 →
 * 值 + 梯度 → `|Q| / max(1, |∇Q|)`）。这一层**不重算**、也不读图元自报的任何东西：
 * 点坐标来自**候选图**，曲线来自**候选图**，两边都不是计划的意图。
 *
 * ## "任意一点"那层普遍性谁负责（不许假装）
 *
 * 核验的永远是**图上这一点**（实例）。"任意一点都成立"不属于这一条：它由报告里既有的
 * `proofScope: figure-instance` + `universalClaims: not-proven` 如实承担；
 * 这一条的 `reason` 里另有一句**指回那里**的披露（题面自己写了"任意"时才会出现）。
 *
 * ## 用例的口径
 *
 * 期望值一律**测试自己算**（把点代进曲线方程），不读被测判据的自报数。
 */
const ELLIPSE_PROMPT = "椭圆 x²/9+y²/4=1，P 是椭圆上任意一点"

const ellipseAction = {
  actionId: "planar.create_conic",
  actionKey: "ellipse",
  factIds: [],
  inputs: { alias: "ellipse", kind: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, label: "椭圆 x²/9+y²/4=1" }
}
const parabolaAction = {
  actionId: "planar.create_conic",
  actionKey: "para",
  factIds: [],
  inputs: { alias: "para", kind: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "x", label: "抛物线 y²=4x" }
}
/** 一条无限长的 x 轴（`parameter` 就是横坐标 —— 与代表题夹具的 `A` 同一种绑法）。 */
const xAxisAction = {
  actionId: "planar.create_line",
  actionKey: "x-axis",
  factIds: [],
  inputs: { alias: "x-axis", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], label: "x 轴" }
}
/** `P` 绑在某个宿主上（参数由调用方给）—— 这是"图上的 P 在哪"的唯一来源。 */
const boundP = (hostAlias: string, parameter: number) => ({
  actionId: "dynamic.create_bound_point",
  actionKey: "P",
  factIds: [],
  inputs: { alias: "P", host: { scope: "draft", alias: hostAlias }, parameter, label: "P" }
})

function plan(actions: readonly unknown[]): PlanEnvelope {
  return { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "圆锥曲线上的点", factIds: [], actions } as unknown as PlanEnvelope
}

function run(prompt: string, actions: readonly unknown[]) {
  return compilePlan(plan(actions), { document: createEmptyDocument("conics"), prompt, conversationId: "point-on-conic", documentGeneration: 0 })
}

/** 核验报告里那一条 `pointOnConic`，附带上"为什么"（读不出报告时把诊断带出来）。 */
function pointOnConicCheck(result: ReturnType<typeof run>) {
  const why = result.diagramVerification === undefined
    ? `没有核验报告；诊断：${result.diagnostics.map((entry) => `${entry.stage}/${entry.code}@${entry.path}: ${entry.detail}`).join("；")}`
    : result.diagramVerification.checks.map((check) => `${check.sourceText}:${check.status}`).join("；")
  const check = result.diagramVerification?.checks.find((entry) => entry.kind === "pointOnConic")
  expect(check, why).toBeDefined()
  return check!
}

describe("点在圆锥曲线上：判据从图上那一点与图上那条曲线自己算", () => {
  it("`P` 真的落在椭圆上 ⇒ `passed`，残差由测试自己按曲线方程复核（并且披露这是**实例**核验）", () => {
    const angle = 0.4
    // `parameter` 就是椭圆的参数角：`P = (3cosθ, 2sinθ)`（与代表题夹具同一个口径）。
    const result = run(ELLIPSE_PROMPT, [ellipseAction, boundP("ellipse", angle)])
    const check = pointOnConicCheck(result)
    expect(result.diagramVerification?.status, `理由：${check.reason}`).toBe("passed")
    expect(check.status, `理由：${check.reason}`).toBe("passed")
    // 自己算：这一点代进 `x²/9 + y²/4 − 1` 恒为 0 ⇒ 残差是浮点噪声。
    const x = 3 * Math.cos(angle)
    const y = 2 * Math.sin(angle)
    expect(check.actual, `实测：${check.actual}`).toBeLessThan(1e-12)
    expect(x * x / 9 + y * y / 4 - 1).toBeCloseTo(0, 12)
    // **披露**：题面写的是"任意一点"，而这里核的是图上这一点 —— 必须说清，不许让绿字冒充全称结论。
    expect(check.reason, `理由：${check.reason}`).toContain("图上这一点")
    expect(check.reason, `理由：${check.reason}`).toContain("任意")
  })

  it("`P` 被绑在 x 轴上（落在椭圆**里面**）⇒ `failed`，残差是测试自己算出来的那个数", () => {
    const result = run(ELLIPSE_PROMPT, [ellipseAction, xAxisAction, boundP("x-axis", 1.5)])
    const check = pointOnConicCheck(result)
    expect(check.status, `理由：${check.reason}`).toBe("failed")
    expect(result.diagramVerification?.status).toBe("failed")
    /**
     * 自己算：`P = (1.5, 0)` ⇒ `Q = 1.5²/9 − 1 = −0.75`、`∇Q = (2·1.5/9, 0) = (1/3, 0)`
     * ⇒ `|∇Q| = 1/3 < 1`，于是残差 `= 0.75 / 1 = 0.75`。
     */
    expect(check.actual, `实测：${check.actual}`).toBeCloseTo(0.75, 9)
  })

  it("题面说**椭圆**、图上画的是**抛物线** ⇒ `failed`，并说清两种曲线（不拿抛物线替椭圆判 P）", () => {
    const result = run(ELLIPSE_PROMPT, [parabolaAction, xAxisAction, boundP("x-axis", 1)])
    const check = pointOnConicCheck(result)
    expect(check.status, `理由：${check.reason}`).toBe("failed")
    expect(check.reason, `理由：${check.reason}`).toContain("抛物线")
    expect(check.reason, `理由：${check.reason}`).toContain("椭圆")
  })

  it("图上根本没有 `P` ⇒ 未核验，理由**点名缺的是 P**（不静默、也不硬凑一个点）", () => {
    const result = run(ELLIPSE_PROMPT, [ellipseAction])
    const check = pointOnConicCheck(result)
    expect(check.status, `理由：${check.reason}`).toBe("unverified")
    expect(check.reason, `理由：${check.reason}`).toContain("点名缺失：P")
  })
})
