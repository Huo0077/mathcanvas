import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

/**
 * **正方体 / 长方体的外接球与内切球半径**（2026-10-20，上一批"派生对象尺寸"的窄口）。
 *
 * 这两条在卷面上就是一句话：`正方体的外接球半径为 3`、`正方体的内切球半径为 1`。
 * 它们是**派生对象**的度量，但**判据不必找那个球** —— 两个半径都是长方体三条棱的函数：
 *
 * | 度量 | 公式（`a ≤ b ≤ c` 是三条棱长） |
 * | --- | --- |
 * | 外接球半径 | `√(a² + b² + c²) / 2`（体对角线的一半） |
 * | 内切球半径 | `a / 2`（最短那条棱的一半 —— 只有正方体才与三条棱都相切） |
 *
 * **为什么先做长方体这一窄类**：这两个公式对**任意长方体**都成立，而且棱长就在图元
 * （`cube` 图元的 `size`）里，不用求球心、不用解方程组。正棱锥的内切球要 `3V/S`（得从网格
 * 算体积与表面积），那是下一步。
 *
 * **一个边界**：`内切球` 对**非正方体**的长方体只在最短棱方向相切（球会悬空），所以那条公式
 * 只对正方体是"内切球"的严格意义 —— 判据照公式量（正方体上它与三条棱都相切），
 * 长方体上的语义在文档里如实记着。
 */
const spheres = (prompt: string) =>
  parseDiagramObligations(prompt).givens
    .filter((item) => item.kind === "solidDimension")
    .map((item) => `${item.solid?.shape}:${item.solid?.metric}=${(item.value ?? Number.NaN).toFixed(6)}`)

describe("外接球 / 内切球半径的读取器", () => {
  it("`正方体的外接球半径为3` ⇒ cuboid:circumradius", () => {
    expect(spheres("正方体的外接球半径为3。")).toEqual([`cuboid:circumradius=${(3).toFixed(6)}`])
  })

  it("`正方体的内切球半径为1` ⇒ cuboid:inradius", () => {
    expect(spheres("正方体的内切球半径为1。")).toEqual([`cuboid:inradius=${(1).toFixed(6)}`])
  })

  it("`该长方体的外接球半径为5` 也读得出（指代写法带出形状名）", () => {
    expect(spheres("在长方体ABCD-A₁B₁C₁D₁中，该长方体的外接球半径为5。")).toEqual([`cuboid:circumradius=${(5).toFixed(6)}`])
  })

  /**
   * **反向判据**：`球` 单独出现时那是**图上的球**，不是长方体的外接球 ——
   * 两者的判据来源完全不同（后者问长方体的三条棱）。
   */
  it("`球的半径为3` 不归这一族（那是图上的球）", () => {
    expect(spheres("球的半径为3。")).toEqual([`sphere:radius=${(3).toFixed(6)}`])
  })
})

/**
 * **接缝层**：`cube` 图元 `size = {2, 3, 6}`（长方体）。
 *
 * 外接球半径 `√(4 + 9 + 36) / 2 = 7 / 2 = 3.5`；内切球半径 `2 / 2 = 1`。
 */
describe("外接球 / 内切球半径量得出来", () => {
  const plan = (size: { x: number; y: number; z: number }) => ({
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "长方体",
    factIds: [],
    actions: [{ actionId: "solid.create_template", actionKey: "cuboid", factIds: [], inputs: { alias: "cuboid", template: "cube", origin: { x: 0, y: 0, z: 0 }, size } }]
  })

  const run = (prompt: string, size: { x: number; y: number; z: number }) =>
    compilePlan(plan(size), { document: createEmptyDocument("geometry3d"), prompt, conversationId: "cuboid-sphere", documentGeneration: 0 })

  const describeChecks = (result: ReturnType<typeof run>) =>
    (result.diagramVerification?.checks ?? []).map((check) => `${check.kind}:${check.status}:${check.reason}`).join("；")

  it("size {2,3,6} ⇒ 外接球半径 3.5 ⇒ passed", () => {
    const result = run("长方体的外接球半径为3.5。", { x: 2, y: 3, z: 6 })
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
    expect(result.diagramVerification?.checks.map((check) => check.kind)).toEqual(["solidDimension"])
  })

  it("size {2,3,6} 却写外接球半径 3 ⇒ failed", () => {
    expect(run("长方体的外接球半径为3。", { x: 2, y: 3, z: 6 }).diagramVerification?.status).toBe("failed")
  })

  it("正方体 size {2,2,2} ⇒ 外接球 √3、内切球 1 都对", () => {
    const outer = run("正方体的外接球半径为√3。", { x: 2, y: 2, z: 2 })
    expect(outer.diagramVerification?.status, describeChecks(outer)).toBe("passed")
    const inner = run("正方体的内切球半径为1。", { x: 2, y: 2, z: 2 })
    expect(inner.diagramVerification?.status, describeChecks(inner)).toBe("passed")
  })

  it("size {2,3,6} ⇒ 内切球半径 1（最短棱的一半）", () => {
    expect(run("长方体的内切球半径为1。", { x: 2, y: 3, z: 6 }).diagramVerification?.status).toBe("passed")
    expect(run("长方体的内切球半径为1.5。", { x: 2, y: 3, z: 6 }).diagramVerification?.status).toBe("failed")
  })

  it("没有长方体的图元时不硬量（`球的半径为3` + 长方体计划 ⇒ 未核验或没有报告）", () => {
    // 这一跑题面说的是图上的球，而计划里没有球 ⇒ 不该拿长方体去顶。
    const result = run("球的半径为3。", { x: 2, y: 2, z: 2 })
    expect(result.diagramVerification?.status ?? "absent").not.toBe("passed")
  })
})
