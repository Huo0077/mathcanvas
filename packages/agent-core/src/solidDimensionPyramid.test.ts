import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

/**
 * **正 N 棱锥的标量尺寸**（2026-10-20，审计 A 类的后半）。
 *
 * 上一批把圆锥 / 圆柱接进了 `solidDimension`。正 N 棱锥**不能照抄**那条路：
 * `solid.create_regular_pyramid` 物化出来的是一整组 `point3 + edge3 + face3 + 一个 polyhedron3`，
 * 图元里**没有** `radius` / `height` —— 那两个数只在**动作**里，文档里没有。
 *
 * 而它是**量得动**的，只要能从图里认出"哪一圈是底面"：非底面的侧面全是**三角形**，
 * 底面是 N 边形 ⇒ 取 `face3` 里**点最多的那一张**就是底环，剩下的那个顶点就是锥顶。于是
 * 底边长 / 底面周长 / 底面积（鞋带公式）/ 侧棱长 / 高（锥顶到底面的距离）全部从**坐标**算出来，
 * 不读动作参数。
 *
 * **一条解不动的边界要如实记着**：`正三棱锥`（N = 3）的四张面**全是三角形**，几何上分不出
 * 哪一张是底面 ⇒ 这条判据返回"未核验"并说清原因，**不按题面顺序猜**。
 *
 * **另一条边界（与救援的边界）**：`正三棱锥` / `正四棱锥` 若同时给了**底面边长**，那条
 * **解析救援**已经把坐标构造出来了（`rescueWithRegular*Pyramid`），同一句再发一条标量义务
 * 只会把救援挡掉（救援要求复核 `passed`）⇒ 这种组合**不重复读**，留给救援。
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

describe("正 N 棱锥的标量尺寸读取", () => {
  it("联考 joint-07：`正六棱锥的底面面积为6√3，侧棱长为5` ⇒ 两条度量", () => {
    const parsed = parseDiagramObligations("正六棱锥的底面面积为6√3，侧棱长为5。")
    expect(parsed.unverified, `未核验：${JSON.stringify(parsed.unverified)}`).toEqual([])
    expect(labels("正六棱锥的底面面积为6√3，侧棱长为5。")).toEqual(["pyramid:baseArea", "pyramid:lateralEdge"])
    const [area, lateral] = stated("正六棱锥的底面面积为6√3，侧棱长为5。")
    expect(area?.value).toBeCloseTo(6 * Math.sqrt(3), 10)
    expect(lateral?.value).toBe(5)
  })

  it("联考 joint-09：`正三棱锥的侧棱长为2，底面周长为9` ⇒ 两条度量", () => {
    expect(labels("正三棱锥的侧棱长为2，底面周长为9。")).toEqual(["pyramid:lateralEdge", "pyramid:basePerimeter"])
    expect(stated("正三棱锥的侧棱长为2，底面周长为9。").map((entry) => entry.value)).toEqual([2, 9])
  })

  it("`正三棱锥的底面边长为2，侧棱长为3` ⇒ 不读（这一组由解析救援负责构造，别把它的路挡掉）", () => {
    expect(labels("正三棱锥的底面边长为2，侧棱长为3。")).toEqual([])
  })

  it("`正四棱锥的底面边长为2，侧棱长为√5` ⇒ 同样不读（救援负责）", () => {
    expect(labels("正四棱锥的底面边长为2，侧棱长为√5。")).toEqual([])
  })
})

/**
 * **读到之后核得出来**（接缝层）：从**坐标**量，不读动作参数。
 *
 * `joint-07` 解出来是底边长 `a = 2`（正六边形面积 `6√3`）与侧棱 `5` ⇒ `R = 2`、`h = √21`。
 */
describe("正 N 棱锥：从坐标量出来再判", () => {
  const N07 = "正六棱锥的底面面积为6√3，侧棱长为5。"
  const N09 = "正三棱锥的侧棱长为2，底面周长为9。"

  const plan = (sides: number, radius: number, height: number) => ({
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "画题面那个正 N 棱锥",
    factIds: [],
    actions: [{ actionId: "solid.create_regular_pyramid", actionKey: "pyramid", factIds: [], inputs: { alias: "pyramid", sides, radius, height } }]
  })

  const run = (prompt: string, sides: number, radius: number, height: number) =>
    compilePlan(plan(sides, radius, height), { document: createEmptyDocument("geometry3d"), prompt, conversationId: "solid-dimension-pyramid", documentGeneration: 0 })

  const describeChecks = (result: ReturnType<typeof run>) =>
    (result.diagramVerification?.checks ?? []).map((check) => `${check.kind}:${check.status}:${check.reason}`).join("；")

  it("joint-07：R = 2、h = √21 ⇒ 底面积与侧棱两条都 passed", () => {
    const result = run(N07, 6, 2, Math.sqrt(21))
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
    expect(result.diagramVerification?.checks.map((check) => check.status)).toEqual(["passed", "passed"])
  })

  it("joint-07：h = 4（侧棱 √20 ≠ 5）⇒ 侧棱那条 failed，底面积那条仍 passed", () => {
    const result = run(N07, 6, 2, 4)
    const checks = result.diagramVerification?.checks ?? []
    expect(checks.map((check) => check.status)).toEqual(["passed", "failed"])
    expect(checks[1]?.sourceText).toContain("侧棱")
  })

  it("joint-07：底面面积不对（R = 3、h = 4 ⇒ 侧棱仍是 5）⇒ 只有底面积那条 failed", () => {
    // 两个度量是**耦合**的：R 一变，侧棱也跟着变。所以这里取 h = 4 让侧棱仍为 √(9+16) = 5，
    // 这一跑的失败就**只**来自底面积（13.5√3 ≠ 6√3）。
    const result = run(N07, 6, 3, 4)
    const checks = result.diagramVerification?.checks ?? []
    expect(checks.map((check) => check.status)).toEqual(["failed", "passed"])
    expect(checks[0]?.sourceText).toContain("底")
  })

  /**
   * **N = 3 的边界**：四张面全是三角形，分不出哪一张是底面 ⇒ 落未核验并**说清原因**，
   * 不按题面顺序猜、也不算通过。
   */
  it("正三棱锥（N = 3）分不出底面 ⇒ 未核验，理由点名「底面」", () => {
    const result = run(N09, 3, 2, Math.sqrt(3))
    const checks = result.diagramVerification?.checks ?? []
    expect(checks.map((check) => check.status)).toEqual(["unverified", "unverified"])
    expect(checks[0]?.reason).toContain("底面")
  })
})
