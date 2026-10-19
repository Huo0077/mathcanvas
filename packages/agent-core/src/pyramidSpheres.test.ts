import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

/**
 * **正 N 棱锥的外接球 / 内切球半径**（2026-10-20，`3V/S` 那条通用路径的窄口）。
 *
 * 两个半径都是"底面外接圆半径 `R`、高 `h`、底面边数 `n`、底边 `a`"的函数 ——
 * 而这几个数**已经在图里量出来了**（`candidatePyramid` 从坐标认底面、`measureSolid` 已有
 * `sides` / `baseEdge` / `baseArea` / `height`）：
 *
 * | 度量 | 公式 |
 * | --- | --- |
 * | 外接球半径 | 球心在轴上 ⇒ `(h² + R²) / (2h)`，其中 `R = a / (2·sin(π/n))` |
 * | 内切球半径 | `3V / S`（内切球存在时这是**恒等式**：`V = ⅓·r·S`） |
 *
 * **`3V/S` 的口径要说清**：它是"存在内切球"时的**必要条件**，所以拿它当判据不会把错的放过
 * （题面自己声称有内切球）；但**球心是不是真的到每个面都等距，今天不验** —— 那是下一步。
 * 失败文案里会把 `V`、`S`、`r` 三个数摆出来，用户能自己复核。
 */
const stated = (prompt: string) =>
  parseDiagramObligations(prompt).givens
    .filter((item) => item.kind === "solidDimension")
    .map((item) => `${item.solid?.shape}:${item.solid?.metric}`)

describe("正 N 棱锥的派生球半径读取器", () => {
  it("`正四棱锥的外接球半径为1.5` ⇒ pyramid:circumradius", () => {
    expect(stated("正四棱锥的外接球半径为1.5。")).toEqual(["pyramid:circumradius"])
  })

  it("`正三棱锥的内切球半径为1` ⇒ pyramid:inradius", () => {
    expect(stated("正三棱锥的内切球半径为1。")).toEqual(["pyramid:inradius"])
  })

  it("正方体 / 长方体的那两条照旧（不回归）", () => {
    expect(stated("正方体的外接球半径为3。")).toEqual(["cuboid:circumradius"])
    expect(stated("长方体的内切球半径为1。")).toEqual(["cuboid:inradius"])
  })
})

/**
 * **接缝层**：正四棱锥，底面外接圆半径 `R = √2`（底边 `a = 2`）、高 `h = 1`。
 *
 * 自己算：外接球 `(h² + R²)/(2h) = (1 + 2)/2 = 1.5`；
 * 内切球 `3V/S` —— `V = ⅓·4·1 = 4/3`，斜高 `√(h² + apothem²) = √2`、侧面共 `4·(½·2·√2) = 4√2`、
 * `S = 4 + 4√2` ⇒ `r = 4/(4 + 4√2) = √2 − 1 ≈ 0.4142136`。
 */
describe("正 N 棱锥的派生球半径量得出来", () => {
  const plan = { sides: 4, radius: Math.SQRT2, height: 1 }
  const INNER = Math.SQRT2 - 1

  const run = (prompt: string) => {
    const envelope = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "正四棱锥",
      factIds: [],
      actions: [{ actionId: "solid.create_regular_pyramid", actionKey: "pyramid", factIds: [], inputs: { alias: "pyramid", ...plan } }]
    }
    return compilePlan(envelope, { document: createEmptyDocument("geometry3d"), prompt, conversationId: "pyramid-spheres", documentGeneration: 0 })
  }

  const describeChecks = (result: ReturnType<typeof run>) =>
    (result.diagramVerification?.checks ?? []).map((check) => `${check.kind}:${check.status}:${check.reason}`).join("；")

  it("外接球半径 1.5 ⇒ passed", () => {
    const result = run("正四棱锥的外接球半径为1.5。")
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
  })

  it("外接球半径 2 ⇒ failed", () => {
    expect(run("正四棱锥的外接球半径为2。").diagramVerification?.status).toBe("failed")
  })

  it(`内切球半径 √2−1（写成小数 ${INNER.toPrecision(12)}）⇒ passed`, () => {
    const result = run(`正四棱锥的内切球半径为${INNER.toPrecision(12)}。`)
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
  })

  it("内切球半径 1 ⇒ failed（它比 √2−1 大了两倍多）", () => {
    expect(run("正四棱锥的内切球半径为1。").diagramVerification?.status).toBe("failed")
  })
})
