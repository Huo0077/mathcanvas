import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

/**
 * **内心有判据了**（2026-10-20，与角平分线同一族的第二个"点到三条边"的条件）。
 *
 * `O 是 △ABC 的内心` ⇔ **到三条边的距离都相等**（都等于内切圆半径）。
 *
 * **判据量的是"到三条边（线段）的距离"，不是"到三条直线的距离"** —— 这一条差别不是洁癖：
 * 直角三角形的 `A`-旁心到三条**直线**的距离也相等（都等于旁切圆半径），只有量**线段**才分得开。
 * 实测：`A(0,0)、B(6,0)、C(0,8)`（内切圆半径 2、旁切圆半径 12）——
 * - 内心 `(2, 2)` ⇒ 到三条线段的距离都是 2 ⇒ 通过；
 * - `A`-旁心 `(12, 12)` ⇒ 到三条直线的距离都是 12，但到 `AB`、`CA` 两条**线段**的垂足落在
 *   延长线上 ⇒ 距离分别是 13.42 与 12.65 ⇒ **不满足**。
 *
 * 判据从最终坐标自己算（与 `planarAngle` / `area` / `angleBisector` 同一条纪律）。
 */
const incenterTargets = (prompt: string) =>
  parseDiagramObligations(prompt).givens.filter((item) => item.kind === "incenter").map((item) => item.targets)

describe("内心的读取器", () => {
  it("`O为△ABC的内心` ⇒ targets [O, A, B, C]", () => {
    expect(incenterTargets("在△ABC中，O为△ABC的内心。")).toEqual([["O", "A", "B", "C"]])
  })

  it("`点O是△ABC的内心` 也读得出", () => {
    expect(incenterTargets("点O是△ABC的内心。")).toEqual([["O", "A", "B", "C"]])
  })

  /** **旁心不是内心**：它在三角形外面，是一个**不同**的判定，今天没有判据 ⇒ 不猜、但要显形。 */
  it("`O为△ABC的旁心` ⇒ 不读，落未核验并点名「旁心」", () => {
    const parsed = parseDiagramObligations("在△ABC中，O为△ABC的旁心。")
    expect(parsed.givens.filter((item) => item.kind === "incenter")).toEqual([])
    expect(parsed.unverified.map((entry) => entry.reason).join("｜")).toContain("旁心")
  })
})

/**
 * **接缝层**：`A(0,0)`、`B(6,0)`、`C(0,8)`。内切圆半径 `r = (6 + 8 − 10) / 2 = 2`。
 */
describe("内心量得出来", () => {
  const point = (name: string, x: number, y: number) =>
    ({ actionId: "planar.create_point", actionKey: name, factIds: [], inputs: { alias: name, points: [{ x, y }], label: name } })

  const run = (o: { x: number; y: number }, prompt = "在△ABC中，O为△ABC的内心。") => {
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "三角形的内心",
      factIds: [],
      actions: [point("A", 0, 0), point("B", 6, 0), point("C", 0, 8), point("O", o.x, o.y)]
    } as unknown as PlanEnvelope
    return compilePlan(plan, { document: createEmptyDocument("conics"), prompt, conversationId: "incenter", documentGeneration: 0 })
  }

  const describeChecks = (result: ReturnType<typeof run>) =>
    (result.diagramVerification?.checks ?? []).map((check) => `${check.kind}:${check.status}:${check.reason}`).join("；")

  it("O(2,2) 是内心 ⇒ passed", () => {
    const result = run({ x: 2, y: 2 })
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
    expect(result.diagramVerification?.checks.map((check) => check.kind)).toEqual(["incenter"])
  })

  it("O(1,1) 到三条边的距离不相等 ⇒ failed", () => {
    const result = run({ x: 1, y: 1 })
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("failed")
  })

  /**
   * **这一条是本轮的重点**：`(12, 12)` 是 `A`-旁心，到三条**直线**的距离都是 12 ——
   * 只判"到直线的距离"就会把它当成内心放过去。
   */
  it("O(12,12) 是 A-旁心（到三条直线的距离相等）⇒ 仍然 failed", () => {
    const result = run({ x: 12, y: 12 })
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("failed")
    expect(result.diagramVerification?.checks[0]?.reason).toContain("边")
  })

  it("图上没有 O ⇒ 未核验（点名缺失，不替它找点）", () => {
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "三角形的内心",
      factIds: [],
      actions: [point("A", 0, 0), point("B", 6, 0), point("C", 0, 8)]
    } as unknown as PlanEnvelope
    const result = compilePlan(plan, { document: createEmptyDocument("conics"), prompt: "在△ABC中，O为△ABC的内心。", conversationId: "incenter-missing", documentGeneration: 0 })
    const checks = result.diagramVerification?.checks ?? []
    expect(checks.map((check) => check.status)).toEqual(["unverified"])
    expect(checks[0]?.reason).toContain("点名缺失")
  })
})
