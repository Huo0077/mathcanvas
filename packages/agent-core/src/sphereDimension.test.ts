import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

/**
 * **球的标量尺寸**（2026-10-20，`solidDimension` 的自然延伸）。
 *
 * 球的图元只带一个 `radius`，于是三个常用度量全是它的函数：
 *
 * | 度量 | 公式 |
 * | --- | --- |
 * | 半径 | `r` |
 * | 表面积 | `4πr²` |
 * | 体积 | `4/3 · πr³` |
 *
 * **为什么不复用实体那条"就近归属"的锚点机制**：球这个字会出现在 `内切球` / `外接球` 里，
 * 而那两个是**挂在别的实体上的派生对象**（不是这条球的图元）。所以球走**自带锚点**的专用句型
 * （`球(心/点名)? 的? 半径/表面积/体积`），`(?<![切接])` 把派生对象挡在外面 ——
 * `正方体的外接球半径为 3` 说的是那个正方体的外接球，**不是**图上单独画的球。
 */
interface Stated {
  shape: string
  metric: string
  value: number
}

const spheres = (prompt: string): Stated[] =>
  parseDiagramObligations(prompt).givens
    .filter((item) => item.kind === "solidDimension")
    .map((item) => ({ shape: item.solid?.shape ?? "?", metric: item.solid?.metric ?? "?", value: item.value ?? Number.NaN }))

const labels = (prompt: string) => spheres(prompt).map((entry) => `${entry.shape}:${entry.metric}`)

describe("球的尺寸读取器", () => {
  it("`球的半径为3` ⇒ sphere:radius", () => {
    expect(labels("球的半径为3。")).toEqual(["sphere:radius"])
    expect(spheres("球的半径为3。")[0]?.value).toBe(3)
  })

  it("`球O的半径是2` 也读得出（球心点名不影响）", () => {
    expect(labels("球O的半径是2。")).toEqual(["sphere:radius"])
  })

  it("`球的表面积为16π` ⇒ sphere:surfaceArea（带 π 的写法照收）", () => {
    expect(labels("球的表面积为16π。")).toEqual(["sphere:surfaceArea"])
    expect(spheres("球的表面积为16π。")[0]?.value).toBeCloseTo(16 * Math.PI, 10)
  })

  it("`球的体积为36π` ⇒ sphere:volume", () => {
    expect(labels("球的体积为36π。")).toEqual(["sphere:volume"])
    expect(spheres("球的体积为36π。")[0]?.value).toBeCloseTo(36 * Math.PI, 10)
  })

  /**
   * **反向判据**：`外接球` / `内切球` 是挂在别的实体上的**派生对象**，不是这条球的图元 ——
   * 把它们读成"球的半径"就是替题面换了一个对象。
   */
  it("`正方体的外接球半径为3` / `其内切球的表面积为4π` ⇒ 不读", () => {
    expect(labels("正方体的外接球半径为3。")).toEqual([])
    expect(labels("正四棱锥的内切球的表面积为4π。")).toEqual([])
  })
})

/**
 * **接缝层**：`r = 3` ⇒ 表面积 `36π`、体积 `36π`（`4/3·π·27 = 36π`，正好撞上，所以另用 `r = 2` 试表面积）。
 */
describe("球的尺寸量得出来", () => {
  const plan = (radius: number) => ({
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "画题面那个球",
    factIds: [],
    actions: [{ actionId: "solid.create_sphere", actionKey: "sphere", factIds: [], inputs: { alias: "sphere", center: { x: 0, y: 0, z: 0 }, radius } }]
  })

  const run = (prompt: string, radius: number) =>
    compilePlan(plan(radius), { document: createEmptyDocument("geometry3d"), prompt, conversationId: "sphere-dimension", documentGeneration: 0 })

  const describeChecks = (result: ReturnType<typeof run>) =>
    (result.diagramVerification?.checks ?? []).map((check) => `${check.kind}:${check.status}:${check.reason}`).join("；")

  it("半径 3 ⇒ 半径那条 passed", () => {
    const result = run("球的半径为3。", 3)
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
    expect(result.diagramVerification?.checks.map((check) => check.kind)).toEqual(["solidDimension"])
  })

  it("半径 2 却写 3 ⇒ failed", () => {
    expect(run("球的半径为3。", 2).diagramVerification?.status).toBe("failed")
  })

  it("半径 2、表面积 16π ⇒ passed（4π·2² = 16π）", () => {
    const result = run("球的表面积为16π。", 2)
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
  })

  it("半径 3、体积 36π ⇒ passed（4/3·π·27 = 36π）", () => {
    expect(run("球的体积为36π。", 3).diagramVerification?.status).toBe("passed")
  })

  it("半径 2、体积 36π ⇒ failed", () => {
    expect(run("球的体积为36π。", 2).diagramVerification?.status).toBe("failed")
  })

  it("题面没给球的尺寸时不开核验（`画一个球` ⇒ 没有报告）", () => {
    expect(run("画一个球。", 3).diagramVerification).toBeUndefined()
  })
})
