import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

/**
 * **外心有判据了**（2026-10-20，"三角形的心"这一族的最后一块）。
 *
 * `O 是 △ABC 的外心` ⇔ **到三个顶点等距**（都等于外接圆半径）。
 *
 * ## 为什么这一条要单独小心
 *
 * `外心` 这两个字**已经有一个构造入口**（`rescueWithCircumcenterPoint`：题面给
 * `2AB·AO=|AB|²`、`2AC·AO=|AC|²` 两条点积条件时，系统自己把外心重建出来）。那条救援的
 * 题面里就带着"**外心**"三个字（`则点O为该三角形的外心`），所以：
 *
 * 1. **判据要加** —— 它把"点到三个顶点等距"变成一个真的能问的问题；
 * 2. **触发词不加** —— 加上去会让那条救援的复核从 `passed` 变成 `unverified`（残留里那句
 *    `该三角形的外心` 会落进未核验），把已经画对的图打回去。这是 2026-10-20 第十三批记下的
 *    同一条教训的第二次应用：**触发词只能加在确实没有任何处理的家族上**。
 *
 * 判据从最终坐标自己算（与 `incenter` / `angleBisector` / 三个心同一条纪律）。
 */
const circumcenters = (prompt: string) =>
  parseDiagramObligations(prompt).givens.filter((item) => item.kind === "circumcenter").map((item) => item.targets)

describe("外心的读取器", () => {
  it("`O为△ABC的外心` ⇒ targets [O, A, B, C]", () => {
    expect(circumcenters("在△ABC中，O为△ABC的外心。")).toEqual([["O", "A", "B", "C"]])
  })

  it("`点O是△ABC的外心` 也读得出", () => {
    expect(circumcenters("点O是△ABC的外心。")).toEqual([["O", "A", "B", "C"]])
  })

  /**
   * **外心救援的题面不能被这条读取器吃掉，也不能因此多出一条未核验**：
   * 那句是"该三角形的外心"（指代），本读取器只认 `O 是 / 为 △ABC 的外心` 这种**明写点名**的说法。
   */
  it("`则点O为该三角形的外心`（指代写法）⇒ 不产义务（那是救援的题面）", () => {
    expect(circumcenters("已知点O为△ABC所在平面内一点，满足2AB·AO=|AB|²，2AC·AO=|AC|²，则点O为该三角形的外心。")).toEqual([])
  })
})

/**
 * **接缝层**：`T1 = A(0,0)、B(6,0)、C(2,4)`。
 *
 * 外心自己解：`AB` 的垂直平分线 `x = 3`；`AC` 的垂直平分线 `x + 2y = 5` ⇒ **`O(3, 1)`**。
 * 三个顶点到它的距离平方都是 10。
 */
describe("外心量得出来", () => {
  const T1 = { a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, c: { x: 2, y: 4 } }
  const PROMPT = "在△ABC中，O为△ABC的外心。"

  const point = (name: string, position: { x: number; y: number }) =>
    ({ actionId: "planar.create_point", actionKey: name, factIds: [], inputs: { alias: name, points: [position], label: name } })

  const run = (o: { x: number; y: number }) => {
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "三角形的外心",
      factIds: [],
      actions: [point("A", T1.a), point("B", T1.b), point("C", T1.c), point("O", o)]
    } as unknown as PlanEnvelope
    return compilePlan(plan, { document: createEmptyDocument("conics"), prompt: PROMPT, conversationId: "circumcenter", documentGeneration: 0 })
  }

  const describeChecks = (result: ReturnType<typeof run>) =>
    (result.diagramVerification?.checks ?? []).map((check) => `${check.kind}:${check.status}:${check.reason}`).join("；")

  it("O(3, 1) 是外心 ⇒ passed", () => {
    const result = run({ x: 3, y: 1 })
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
    expect(result.diagramVerification?.checks.map((check) => check.kind)).toEqual(["circumcenter"])
  })

  it("拿重心 (8/3, 4/3) 冒充外心 ⇒ failed", () => {
    expect(run({ x: 8 / 3, y: 4 / 3 }).diagramVerification?.status).toBe("failed")
  })

  it("拿垂心 (2, 2) 冒充外心 ⇒ failed", () => {
    expect(run({ x: 2, y: 2 }).diagramVerification?.status).toBe("failed")
  })

  it("图上没有 O ⇒ 未核验（点名缺失）—— 外心不吃「O 按原点」那条约定的", () => {
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "三角形的外心",
      factIds: [],
      actions: [point("A", T1.a), point("B", T1.b), point("C", T1.c)]
    } as unknown as PlanEnvelope
    const result = compilePlan(plan, { document: createEmptyDocument("conics"), prompt: PROMPT, conversationId: "circumcenter-missing", documentGeneration: 0 })
    const checks = result.diagramVerification?.checks ?? []
    expect(checks.map((check) => check.status)).toEqual(["unverified"])
    expect(checks[0]?.reason).toContain("点名缺失")
  })
})
