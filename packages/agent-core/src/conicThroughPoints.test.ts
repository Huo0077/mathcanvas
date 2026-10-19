import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **曲线过点**（2026-10-19 联考 `joint-30`：`双曲线过点 A、B`）。
 *
 * 这是一条**条件**，不是曲线方程的写法：那几个点必须落在这条曲线上。判据层早就有
 * "点到圆锥曲线的残差"（`pointOnConic`），所以本批只加了一个读取器 —— 这一组用例把
 * 读取器与判据**接在一起**钉住：两个点都在曲线上才全绿，任一点不在就红那一条。
 *
 * 期望值一律**测试自己算**（把点代进曲线方程），不读判据自报的数。
 */
const PROMPT = "椭圆 x²/9+y²/4=1 过点 P、Q。"

const ellipseAction = {
  actionId: "planar.create_conic",
  actionKey: "ellipse",
  factIds: [],
  inputs: { alias: "ellipse", kind: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, label: "椭圆 x²/9+y²/4=1" }
}
/** 一条无限长的 x 轴：用来把"不在椭圆上"的点放到椭圆内部。 */
const xAxisAction = {
  actionId: "planar.create_line",
  actionKey: "x-axis",
  factIds: [],
  inputs: { alias: "x-axis", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], label: "x 轴" }
}
/** 把一个点绑在宿主上（参数含义由宿主决定：椭圆是参数角、直线是横坐标）。 */
const bound = (name: string, hostAlias: string, parameter: number) => ({
  actionId: "dynamic.create_bound_point",
  actionKey: name,
  factIds: [],
  inputs: { alias: name, host: { scope: "draft", alias: hostAlias }, parameter, label: name }
})

function plan(actions: readonly unknown[]): PlanEnvelope {
  return { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "曲线过点", factIds: [], actions } as unknown as PlanEnvelope
}

function run(actions: readonly unknown[]) {
  return compilePlan(plan(actions), { document: createEmptyDocument("conics"), prompt: PROMPT, conversationId: "conic-through-points", documentGeneration: 0 })
}

const onConicChecks = (result: ReturnType<typeof run>) => (result.diagramVerification?.checks ?? []).filter((check) => check.kind === "pointOnConic")
const describeChecks = (result: ReturnType<typeof run>) =>
  (result.diagramVerification?.checks ?? []).map((check) => `${check.sourceText} => ${check.status}`).join("；")

describe("曲线过点：两点都在曲线上才全绿", () => {
  it("`椭圆 … 过点 P、Q`，两点都绑在椭圆上 ⇒ 两条 `pointOnConic` 都是 passed", () => {
    const result = run([ellipseAction, bound("P", "ellipse", 0.4), bound("Q", "ellipse", 1.2)])

    const checks = onConicChecks(result)
    expect(checks.length, describeChecks(result)).toBe(2)
    expect(checks.map((check) => check.status), describeChecks(result)).toEqual(["passed", "passed"])
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")

    // 自己算：参数角 θ ⇒ (3cosθ, 2sinθ)，代进 x²/9 + y²/4 − 1 恒为 0。
    for (const angle of [0.4, 1.2]) {
      const x = 3 * Math.cos(angle)
      const y = 2 * Math.sin(angle)
      expect(x * x / 9 + y * y / 4 - 1).toBeCloseTo(0, 12)
    }
  })

  it("`Q` 被绑在 x 轴上（落在椭圆里面）⇒ 只有 `Q` 那条红，`P` 仍然绿", () => {
    const result = run([ellipseAction, xAxisAction, bound("P", "ellipse", 0.4), bound("Q", "x-axis", 5)])

    const checks = onConicChecks(result)
    expect(checks.length, describeChecks(result)).toBe(2)
    // 两条义务共用同一句 `sourceText`（这是全句），哪一条红要看 `reason` 里的点名。
    expect(checks.map((check) => check.status).sort(), describeChecks(result)).toEqual(["failed", "passed"])
    const failed = checks.find((check) => check.status === "failed")!
    expect(failed.reason, failed.reason).toContain("Q")
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("failed")
  })
})
