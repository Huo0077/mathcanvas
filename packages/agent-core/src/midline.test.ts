import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

/**
 * **中位线有判据了**（2026-10-20，那批"只有显形"的家族里最常用的一个）。
 *
 * `DE 是 △ABC 的中位线` 的**难点是"哪两条边"**：题面不说，而三对边各有一条中位线。
 * 所以判据**不去猜** —— 直接把三条边的中点算出来（`M_AB`、`M_BC`、`M_CA`），问
 * "`D`、`E` 是不是**恰好落在其中两个不同的中点**上"（**存在性**，与"旁心是三个之一"同一种读法）。
 *
 * 中位线定理的另外两条（`DE ∥ 第三边`、`DE = 第三边的一半`）**因此不必单独判**：
 * 两端的点都是中点时，它们自动成立 —— 多判一条只是把同一件事说三遍。
 *
 * `DE 是梯形 ABCD 的中位线` **不归这一族**（那是另一条定理：长度是上下底之和的一半），
 * 句型要求"三角形 + 三个点名"，梯形写法读不出来就如实落未核验。
 */
const midlines = (prompt: string) =>
  parseDiagramObligations(prompt).givens.filter((item) => item.kind === "midline").map((item) => item.targets)

describe("中位线的读取器", () => {
  it("`DE是△ABC的中位线` ⇒ targets [D, E, A, B, C]（两个端点在前）", () => {
    expect(midlines("在△ABC中，DE是△ABC的中位线。")).toEqual([["D", "E", "A", "B", "C"]])
  })

  it("`DE为△ABC的中位线` 也读得出", () => {
    expect(midlines("在△ABC中，DE为△ABC的中位线。")).toEqual([["D", "E", "A", "B", "C"]])
  })

  it("梯形的中位线不归这一族", () => {
    expect(midlines("在梯形ABCD中，EF是梯形ABCD的中位线。")).toEqual([])
  })
})

/**
 * **接缝层**：`A(0,0)、B(4,0)、C(0,4)`。三条边的中点是 `M_AB(2,0)`、`M_BC(2,2)`、`M_CA(0,2)`。
 */
describe("中位线量得出来", () => {
  const point = (name: string, x: number, y: number) =>
    ({ actionId: "planar.create_point", actionKey: name, factIds: [], inputs: { alias: name, points: [{ x, y }], label: name } })

  const run = (d: { x: number; y: number }, e: { x: number; y: number }) => {
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "三角形的中位线",
      factIds: [],
      actions: [point("A", 0, 0), point("B", 4, 0), point("C", 0, 4), point("D", d.x, d.y), point("E", e.x, e.y)]
    } as unknown as PlanEnvelope
    return compilePlan(plan, { document: createEmptyDocument("conics"), prompt: "在△ABC中，DE是△ABC的中位线。", conversationId: "midline", documentGeneration: 0 })
  }

  const describeChecks = (result: ReturnType<typeof run>) =>
    (result.diagramVerification?.checks ?? []).map((check) => `${check.kind}:${check.status}:${check.reason}`).join("；")

  it("D 是 AB 的中点、E 是 BC 的中点 ⇒ passed", () => {
    const result = run({ x: 2, y: 0 }, { x: 2, y: 2 })
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
    expect(result.diagramVerification?.checks.map((check) => check.kind)).toEqual(["midline"])
  })

  it("换另外一对边（AB 与 CA）也 passed", () => {
    expect(run({ x: 2, y: 0 }, { x: 0, y: 2 }).diagramVerification?.status).toBe("passed")
  })

  /** **端点的顺序不该影响结果**（题面写 `DE` 还是 `ED` 是同一件事的两端）。 */
  it("两端写反（E 在前）也 passed", () => {
    expect(run({ x: 2, y: 2 }, { x: 2, y: 0 }).diagramVerification?.status).toBe("passed")
  })

  it("D 落在三角形中心（不是任何边的中点）⇒ failed", () => {
    expect(run({ x: 4 / 3, y: 4 / 3 }, { x: 2, y: 2 }).diagramVerification?.status).toBe("failed")
  })

  it("两个端点落在**同一个**中点 ⇒ failed（那不是中位线，是一条退化的点）", () => {
    expect(run({ x: 2, y: 0 }, { x: 2, y: 0 }).diagramVerification?.status).toBe("failed")
  })

  it("图上没有 D ⇒ 未核验（点名缺失）", () => {
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "三角形的中位线",
      factIds: [],
      actions: [point("A", 0, 0), point("B", 4, 0), point("C", 0, 4), point("E", 2, 2)]
    } as unknown as PlanEnvelope
    const result = compilePlan(plan, { document: createEmptyDocument("conics"), prompt: "在△ABC中，DE是△ABC的中位线。", conversationId: "midline-missing", documentGeneration: 0 })
    const checks = result.diagramVerification?.checks ?? []
    expect(checks.map((check) => check.status)).toEqual(["unverified"])
    expect(checks[0]?.reason).toContain("点名缺失")
  })
})
