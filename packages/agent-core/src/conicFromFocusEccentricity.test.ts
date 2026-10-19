import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

/**
 * **「焦点 + 离心率 ⇒ 曲线」这一类写法**（2026-10-20，联考 30 题「无核验项」审计里的 B 类）。
 *
 * 高考圆锥曲线大题**几乎不直接给方程**，给的是"中心在原点、右焦点 (c,0)、离心率 e"这种**参数**，
 * 方程要自己解出来。今天的读取器只会从**方程**认曲线，于是 `joint-23`
 *（`双曲线C的中心为坐标原点，右焦点为(2√5,0)，离心率为√5`）一个义务都产不出来 ——
 * 图能画，但没有任何东西被核验。
 *
 * **这不是"猜"，是等式推导**：中心在原点 + 焦点在一条坐标轴上 + 离心率，这三个数把标准位置的
 * 椭圆 / 双曲线**唯一确定**（`a = c/e`，`b² = a² − c²` 或 `c² − a²`；抛物线只需焦点，`p = 2c`）。
 * 所以判据层**不需要新东西** —— 推出来的 `a`、`b`、轴就是既有的 `conicAxes` 判据要量的那三样。
 *
 * **三条边界必须一起钉住**（否则就是"替题面猜曲线"）：
 * 1. 只给离心率、不给焦点坐标 ⇒ **读不出**（离心率只管形状、不管大小），如实未核验；
 * 2. 只给焦点坐标、不给离心率 ⇒ 椭圆 / 双曲线**读不出**（`a` 未知），如实未核验；
 * 3. 离心率与曲线种类矛盾（椭圆给 `e > 1`、双曲线给 `e < 1`）⇒ **不猜**，如实未核验。
 */
const axes = (prompt: string) => parseDiagramObligations(prompt).givens.filter((entry) => entry.kind === "conicAxes")

describe("焦点 + 离心率 ⇒ 标准位置的曲线", () => {
  it("双曲线：右焦点 (2√5,0)、离心率 √5 ⇒ x²/4 − y²/16 = 1", () => {
    // 联考 joint-23 的原话。c = 2√5、e = √5 ⇒ a = c/e = 2、b² = c² − a² = 20 − 4 = 16。
    const parsed = parseDiagramObligations("双曲线C的中心为坐标原点，右焦点为(2√5,0)，离心率为√5。")
    expect(parsed.unverified, `未核验：${JSON.stringify(parsed.unverified)}`).toEqual([])
    expect(axes("双曲线C的中心为坐标原点，右焦点为(2√5,0)，离心率为√5。")).toEqual([
      expect.objectContaining({ conic: { kind: "hyperbola", radiusX: 2, radiusY: 4, axis: "x" } })
    ])
    expect(parsed.givens).toHaveLength(1)
  })

  it("椭圆：右焦点 (2,0)、离心率 1/2 ⇒ a = 4、b = 2√3", () => {
    const parsed = parseDiagramObligations("椭圆E的中心为坐标原点，右焦点为(2,0)，离心率为1/2。")
    expect(parsed.unverified, `未核验：${JSON.stringify(parsed.unverified)}`).toEqual([])
    const [obligation] = axes("椭圆E的中心为坐标原点，右焦点为(2,0)，离心率为1/2。")
    expect(obligation?.conic).toMatchObject({ kind: "ellipse", radiusX: 4 })
    // b² = a² − c² = 16 − 4 = 12 ⇒ b = 2√3。
    expect((obligation?.conic as { radiusY?: number }).radiusY).toBeCloseTo(Math.sqrt(12), 10)
  })

  it("上焦点也跟着换轴：椭圆上焦点 (0,3)、离心率 3/5 ⇒ 长轴在 y 上", () => {
    const [obligation] = axes("椭圆E的中心为坐标原点，上焦点为(0,3)，离心率为3/5。")
    expect(obligation?.conic).toMatchObject({ kind: "ellipse", radiusX: 4, radiusY: 5 })
  })

  it("抛物线只要焦点：焦点 (1,0) ⇒ y² = 4x（`p = 2c = 2`）", () => {
    const parsed = parseDiagramObligations("抛物线C的顶点为坐标原点，焦点为(1,0)。")
    expect(parsed.unverified, `未核验：${JSON.stringify(parsed.unverified)}`).toEqual([])
    expect(axes("抛物线C的顶点为坐标原点，焦点为(1,0)。")).toEqual([
      expect.objectContaining({ conic: { kind: "parabola", focalParameter: 2, axis: "x" } })
    ])
  })
})

describe("数据不全或自相矛盾时不许猜", () => {
  const report = (prompt: string) => ({
    conicAxes: axes(prompt).length,
    unverified: parseDiagramObligations(prompt).unverified.map((entry) => `${entry.sourceText}｜${entry.reason}`).join("\n")
  })

  it("只给离心率（没有焦点坐标）⇒ 不产义务，且显形", () => {
    const read = report("椭圆E的中心为坐标原点，离心率为√3/2。")
    expect(read.conicAxes).toBe(0)
    expect(read.unverified).toContain("离心率")
  })

  it("只给焦点坐标（没有离心率）⇒ 椭圆 / 双曲线读不出 a，显形", () => {
    const read = report("双曲线C的中心为坐标原点，右焦点为(2,0)。")
    expect(read.conicAxes).toBe(0)
    expect(read.unverified).toContain("离心率")
  })

  it("离心率与曲线种类矛盾（椭圆给 √5）⇒ 不猜", () => {
    const read = report("椭圆E的中心为坐标原点，右焦点为(2,0)，离心率为√5。")
    expect(read.conicAxes).toBe(0)
    expect(read.unverified).toContain("离心率")
  })

  it("焦点不在坐标轴上（曲线是斜的）⇒ 今天只认标准位置", () => {
    const read = report("椭圆E的中心为坐标原点，焦点为(1,1)，离心率为1/2。")
    expect(read.conicAxes).toBe(0)
    expect(read.unverified).toContain("焦点")
  })
})

describe("已经有方程时不再从参数推一遍", () => {
  it("方程与参数同时出现 ⇒ 只留方程那一条", () => {
    const prompt = "双曲线C：x²/4−y²/16=1，其中心为坐标原点，右焦点为(2√5,0)，离心率为√5。"
    expect(axes(prompt)).toHaveLength(1)
    expect(axes(prompt)[0]?.conic).toEqual({ kind: "hyperbola", radiusX: 2, radiusY: 4, axis: "x" })
  })
})

/**
 * **读到之后判据真的会用上它**（接缝层）。
 *
 * 只钉读取器是不够的：这条义务能不能被核，取决于 `candidateConic` 认不认图上那条双曲线，
 * 以及 `conicAxes` 判据量的到底是哪三样。所以这里把**一份计划**喂进 `compilePlan`：
 * 画对了 ⇒ `passed`；两个半轴对调 ⇒ `failed`（半轴对调**就是另一条曲线**，焦点换了轴）。
 */
describe("读到之后核得出来（计划 → 核验报告）", () => {
  const PROMPT = "双曲线C的中心为坐标原点，右焦点为(2√5,0)，离心率为√5。"
  const plan = (radiusX: number, radiusY: number) => ({
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "画题面那条双曲线",
    factIds: [],
    actions: [{
      actionId: "planar.create_conic",
      actionKey: "hyperbola",
      factIds: [],
      inputs: { alias: "hyperbola", kind: "hyperbola", center: { x: 0, y: 0 }, radiusX, radiusY, axis: "x", label: "双曲线C" }
    }]
  })

  const run = (radiusX: number, radiusY: number) =>
    compilePlan(plan(radiusX, radiusY), { document: createEmptyDocument("conics"), prompt: PROMPT, conversationId: "focus-eccentricity", documentGeneration: 0 })

  it("画成 x²/4 − y²/16 = 1 ⇒ 报告 passed", () => {
    const compiled = run(2, 4)
    expect(compiled.diagramVerification?.checks.map((check) => `${check.kind}:${check.status}`), compiled.diagnostics.map((item) => item.detail).join("; ")).toEqual(["conicAxes:passed"])
    expect(compiled.diagramVerification?.status).toBe("passed")
  })

  it("两个半轴对调（x²/16 − y²/4 = 1）⇒ failed，不是「未核验」", () => {
    const compiled = run(4, 2)
    expect(compiled.diagramVerification?.checks.map((check) => check.status)).toEqual(["failed"])
    expect(compiled.diagramVerification?.status).toBe("failed")
  })
})
