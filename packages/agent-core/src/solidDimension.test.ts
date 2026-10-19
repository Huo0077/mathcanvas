import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

/**
 * **实体的标量尺寸**（2026-10-20，联考 30 题「无核验项」审计里的 A 类）。
 *
 * 审计算出来的是：7 道「无核验项」里有 **5 道给的是标量**（底面半径 / 母线长 / 底面积 / 侧面积 /
 * 底面周长 / 侧棱长 / 仰角），而它们的**主因不是解析器** —— 是 `planCompiler.planHasVerifiableFigure`
 * 只认「能让题面点名拿到坐标」的动作，**圆锥（`solid.create_template`）与正 N 棱锥不在里面**，
 * 于是 `obligations` 是 `null`、`diagramVerification` 是 `undefined`，**核验根本没跑**。
 *
 * 这一批先补**圆锥 / 圆柱**这一族（图元是 `cone` / `cylinder`，参数 `radius` 与 `height` 就在文档里，
 * 量得动）。五个度量全都能从这两个数算出来：
 *
 * | 度量 | 圆锥 | 圆柱 |
 * | --- | --- | --- |
 * | 半径 | `r` | `r` |
 * | 高 | `h` | `h` |
 * | 母线 | `√(r²+h²)`（**斜的**） | `h`（母线与高是同一条） |
 * | 底面积 | `πr²` | `πr²` |
 * | 侧面积 | `πr√(r²+h²)` | `2πrh` |
 *
 * **为什么这不算「拿模型自报的数字给自己盖章」**：半径确实是模型填进 `radius` 的那个数，但
 * **母线 / 底面积 / 侧面积不是** —— 它们由 `r`、`h` 共同决定。模型随手填一个高度，母线就对不上
 * （联考 `joint-01` 那种「半径 2、母线 3」要求 `h = √5`）。所以这一批把「画一个圆锥」升级成
 * 「画一个**母线真的等于 3** 的圆锥」。
 *
 * **边界（这一批没做）**：正 N 棱锥（图元是模板编号，量它的底面要走另一条路）、
 * 仰角类文字应用题（`joint-10`）。
 */
interface Stated {
  shape: string
  metric: string
  value: number
}

const stated = (prompt: string): Stated[] =>
  parseDiagramObligations(prompt).givens
    .filter((item) => item.kind === "solidDimension")
    .map((item) => ({ shape: item.solid?.shape ?? "?", metric: item.solid?.metric ?? "?", value: item.value ?? Number.NaN }))

const labels = (prompt: string) => stated(prompt).map((entry) => `${entry.shape}:${entry.metric}`)

describe("标量尺寸的读取器（圆锥 / 圆柱）", () => {
  it("联考 joint-01：`圆锥的底面半径为2，母线长为3` ⇒ 两条度量", () => {
    const parsed = parseDiagramObligations("一个圆锥的底面半径为2，母线长为3。")
    expect(parsed.unverified, `未核验：${JSON.stringify(parsed.unverified)}`).toEqual([])
    expect(labels("一个圆锥的底面半径为2，母线长为3。")).toEqual(["cone:radius", "cone:slantHeight"])
    expect(stated("一个圆锥的底面半径为2，母线长为3。").map((entry) => entry.value)).toEqual([2, 3])
  })

  it("联考 joint-12：`圆锥的底面积为π，侧面积为2π` ⇒ 两条度量（带 π 的数也读）", () => {
    const [base, lateral] = stated("一个圆锥的底面积为π，侧面积为2π。")
    expect(labels("一个圆锥的底面积为π，侧面积为2π。")).toEqual(["cone:baseArea", "cone:lateralArea"])
    expect(base?.value).toBeCloseTo(Math.PI, 12)
    expect(lateral?.value).toBeCloseTo(2 * Math.PI, 12)
  })

  it("圆柱的母线与高是同一条：`母线长为2` 读成 `slantHeight`，`高为2` 读成 `height`", () => {
    expect(labels("圆柱的底面半径为1，高为2。")).toEqual(["cylinder:radius", "cylinder:height"])
    expect(labels("圆柱的母线长为2。")).toEqual(["cylinder:slantHeight"])
  })

  it("`圆锥的侧面展开图是半径为3的半圆` 不读半径 —— 那个半径属于展开图，不是圆锥的", () => {
    expect(labels("圆锥的侧面展开图是半径为3的半圆。")).toEqual([])
  })

  it("没有圆锥 / 圆柱在场时一个也不读（`△ABC 的高为 2` 不是实体尺寸）", () => {
    expect(labels("在△ABC中，AD⊥BC，△ABC的高为2。")).toEqual([])
  })
})

/**
 * **读到之后判据真的会用上它**（接缝层）。
 *
 * 只钉读取器不够：这条义务能不能被核，取决于能不能在候选图里找到**那条新画的圆锥**，
 * 并从它自己的 `radius` / `height` 把度量算出来。所以这里把**一份计划**喂进 `compilePlan`。
 *
 * `joint-01` 的题面要求 `r = 2`、母线 `= 3` ⇒ 高必须是 `√5 = 2.236…`。
 */
describe("读到之后核得出来（计划 → 核验报告）", () => {
  const PROMPT = "一个圆锥的底面半径为2，母线长为3。"

  const plan = (radius: number, height: number) => ({
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "画题面那个圆锥",
    factIds: [],
    actions: [{ actionId: "solid.create_template", actionKey: "cone", factIds: [], inputs: { alias: "cone", template: "cone", radius, height } }]
  })

  const run = (prompt: string, radius: number, height: number) =>
    compilePlan(plan(radius, height), { document: createEmptyDocument("geometry3d"), prompt, conversationId: "solid-dimension", documentGeneration: 0 })

  const describeChecks = (result: ReturnType<typeof run>) =>
    (result.diagramVerification?.checks ?? []).map((check) => `${check.kind}:${check.status}:${check.reason}`).join("；")

  it("半径 2、高 √5（母线真的等于 3）⇒ 两条都 passed", () => {
    const result = run(PROMPT, 2, Math.sqrt(5))
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
    expect(result.diagramVerification?.checks.map((check) => `${check.kind}:${check.status}`)).toEqual([
      "solidDimension:passed",
      "solidDimension:passed"
    ])
  })

  it("半径 2、高 4（母线 √20 ≠ 3）⇒ failed，并说清是哪一条", () => {
    const result = run(PROMPT, 2, 4)
    const checks = result.diagramVerification?.checks ?? []
    expect(checks.map((check) => check.status)).toEqual(["passed", "failed"])
    expect(checks[1]?.sourceText).toContain("母线")
    expect(checks[1]?.reason).toContain("母线")
  })

  it("半径不对 ⇒ 半径那一条 failed（那是「不符合题面」，不是「量不出来」）", () => {
    // r = 1.5、h = √6.75 ⇒ 母线 = √(2.25 + 6.75) = 3（母线仍然对），
    // 所以这一跑的失败**只能**来自半径那一条。
    const result = run(PROMPT, 1.5, Math.sqrt(6.75))
    const checks = result.diagramVerification?.checks ?? []
    expect(checks.map((check) => check.status)).toEqual(["failed", "passed"])
    expect(checks[0]?.sourceText).toContain("半径")
  })

  /**
   * **闸门不许放宽**（本节重点）：只有题面**真的给了实体尺寸**时才开核验。
   * 「画一个圆锥」这种没有任何尺寸的题面、以及「正方体的棱长为2」这种不归这一族的题面，
   * 都必须与改动之前**逐字一样**（`diagramVerification === undefined`）。
   */
  it("题面没有实体尺寸时不开核验（`画一个圆锥` ⇒ 没有报告）", () => {
    const result = run("画一个圆锥。", 2, Math.sqrt(5))
    expect(result.diagramVerification).toBeUndefined()
  })

  /**
   * **面积类也要走一遍判据**（联考 `joint-12`：`底面积为π，侧面积为2π`）。
   * 题面解出来是 `r = 1`、`l = 2` ⇒ `h = √3`；这时底面积 `πr² = π`、侧面积 `πrl = 2π` 都对。
   */
  it("联考 joint-12：底面积 π、侧面积 2π ⇒ 半径 1、高 √3 时两条都 passed", () => {
    const areaPrompt = "一个圆锥的底面积为π，侧面积为2π。"
    const result = run(areaPrompt, 1, Math.sqrt(3))
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
    expect(result.diagramVerification?.checks.map((check) => check.kind)).toEqual(["solidDimension", "solidDimension"])
  })

  it("别的形状的尺寸不归这一族（`正方体的棱长为2` ⇒ 仍不开核验）", () => {
    const cube = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "画正方体",
      factIds: [],
      actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", size: { x: 2, y: 2, z: 2 } } }]
    }
    const result = compilePlan(cube, { document: createEmptyDocument("geometry3d"), prompt: "正方体的棱长为2。", conversationId: "solid-dimension-cube", documentGeneration: 0 })
    expect(result.diagramVerification).toBeUndefined()
  })
})
