import { createEmptyDocument } from "@draw/dsl"
import { conicResidualAt } from "@draw/geometry-kernel"
import { describe, expect, it } from "vitest"

import { routeDeterministicProblem } from "../deterministicProblemRoute"
import { compilePlan } from "../planCompiler"
import { tryBuildPlanarDrawingPlan } from "./planarDrawing"

function compileConicPlan(prompt: string, options: { drawingIntentCheck?: boolean; selectedSubquestion?: number } = {}) {
  const built = tryBuildPlanarDrawingPlan(prompt)
  expect(built).not.toBeNull()
  if (built === null) throw new Error("expected planar drawing plan")
  const compiled = compilePlan(built.plan, {
    document: createEmptyDocument("conics"),
    prompt,
    diagramObligationIR: true,
    drawingIntentCheck: options.drawingIntentCheck ?? true,
    ...(options.selectedSubquestion === undefined ? {} : { selectedSubquestion: options.selectedSubquestion })
  })
  if (!compiled.ok) {
    throw new Error(`compilePlan failed: ${JSON.stringify(compiled.diagnostics)}`)
  }
  return { built, compiled }
}

describe("P4 / T07 planar & conic solver-first deterministic construction", () => {
  it("constructs GK-P01 ellipse (a=2, b=sqrt(2)) with foci, chord AB and origin-vertex triangle", () => {
    const prompt = "已知椭圆 C：x²/a²+y²/b²=1（a>b>0）的离心率为√2/2，长轴长为4。（1）求C的方程；（2）过点(0,-2)的直线l交C于A、B两点，O为坐标原点。若△OAB的面积为√2，求|AB|。"
    const { built, compiled } = compileConicPlan(prompt)
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).not.toBe("failed")
    expect(compiled.diagramVerification?.checks.some((c) => c.kind === "conicAxes" && c.status === "passed")).toBe(true)
    expect(compiled.diagramVerification?.checks.some((c) => c.kind === "parameterDomain" && c.status === "passed")).toBe(true)
    const doc = compiled.draftDocument!
    const conic = doc.primitives.find((p) => p.type === "ellipse")
    expect(conic).toBeDefined()
    if (!conic || conic.type !== "ellipse") throw new Error("expected ellipse")
    expect(conic.radiusX).toBeCloseTo(2, 6)
    expect(conic.radiusY).toBeCloseTo(Math.SQRT2, 6)
    expect(built.summary.kind).toBe("solved")

    const points = doc.primitives.filter((p) => p.type === "point")
    const pointA = points.find((p) => p.label === "A")!
    const pointB = points.find((p) => p.label === "B")!
    const pointO = points.find((p) => p.label === "O")!
    expect(pointA).toBeDefined()
    expect(pointB).toBeDefined()
    expect(pointO).toBeDefined()
    expect(conicResidualAt(conic, pointA)!.residual).toBeLessThan(1e-9)
    expect(conicResidualAt(conic, pointB)!.residual).toBeLessThan(1e-9)
  })

  it("constructs GK-P08 hyperbola y²-x²/m²=1 and tangent circle x²+y²-4y+3=0 with m=1/sqrt(3)", () => {
    const prompt = "14. 若双曲线 $y^{2}-\\frac{x^{2}}{m^{2}}=1(m>0)$ 的渐近线与圆 $x^{2}+y^{2}-4 y+3=0$ 相切, 则\n\n$m=$\n"
    const { compiled } = compileConicPlan(prompt, { drawingIntentCheck: false })
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).not.toBe("failed")
    const doc = compiled.draftDocument!
    const hyperbola = doc.primitives.find((p) => p.type === "hyperbola")
    const circle = doc.primitives.find((p) => p.type === "circle")
    expect(hyperbola).toBeDefined()
    expect(circle).toBeDefined()
    if (!hyperbola || hyperbola.type !== "hyperbola") throw new Error("expected hyperbola")
    expect(hyperbola.axis).toBe("y")
    expect(hyperbola.radiusY).toBeCloseTo(1, 6)
    expect(hyperbola.radiusX).toBeCloseTo(1 / Math.sqrt(3), 6)
    if (!circle || circle.type !== "circle") throw new Error("expected circle")
    expect(circle.center.y).toBeCloseTo(2, 6)
    expect(circle.radius).toBeCloseTo(1, 6)
  })

  it("constructs JT-P03 parabola y²=4x, orthogonal chords OA/OB and intersections D/E on l: y=x+1", () => {
    const prompt = "已知抛物线 C：y²=4x 的顶点为 O，过点 (2, 0) 的直线交 C 于 A，B 两点。（1）判断 向量OA·向量OB 是否为定值，并说明理由；（2）设直线 OA，OB 分别与直线 l：y=x+1 交于点 D，E，求 |DE| 的最小值。"
    const { compiled } = compileConicPlan(prompt, { selectedSubquestion: 1 })
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).not.toBe("failed")
    expect(compiled.diagramVerification?.checks.some((c) => c.kind === "conicAxes" && c.status === "passed")).toBe(true)
    const doc = compiled.draftDocument!
    const parabola = doc.primitives.find((p) => p.type === "parabola")
    expect(parabola).toBeDefined()
    if (!parabola || parabola.type !== "parabola") throw new Error("expected parabola")
    expect(parabola.focalParameter).toBeCloseTo(2, 6)

    const points = doc.primitives.filter((p) => p.type === "point")
    for (const label of ["O", "A", "B", "D", "E"]) {
      expect(points.some((p) => p.label === label)).toBe(true)
    }
    const pointA = points.find((p) => p.label === "A")!
    const pointB = points.find((p) => p.label === "B")!
    const pointD = points.find((p) => p.label === "D")!
    const pointE = points.find((p) => p.label === "E")!
    expect(conicResidualAt(parabola, pointA)!.residual).toBeLessThan(1e-9)
    expect(conicResidualAt(parabola, pointB)!.residual).toBeLessThan(1e-9)
    expect(pointD.y - (pointD.x + 1)).toBeCloseTo(0, 6)
    expect(pointE.y - (pointE.x + 1)).toBeCloseTo(0, 6)
  })

  it("constructs JT-P06 ellipse with foci F₁, F₂, point M(2, 2√5/5) and diagnoses infeasible PF₁⊥PF₂ when b > c", () => {
    const prompt = "已知 F₁，F₂ 是椭圆 C：x²/a² + y²/b² = 1 (a>b>0) 的两个焦点，|F₁F₂|=2，M(2, 2√5/5) 为 C 上一点。（1）求椭圆 C 的标准方程；（2）若 P 为 C 上一点，且 PF₁⊥PF₂，求 △F₁PF₂ 的面积。"
    const { built, compiled } = compileConicPlan(prompt, { drawingIntentCheck: false })
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).not.toBe("failed")
    expect(compiled.diagramVerification?.checks.some((c) => c.kind === "fixedLength" && c.status === "passed")).toBe(true)
    expect(compiled.diagramVerification?.checks.some((c) => c.kind === "parameterDomain" && c.status === "passed")).toBe(true)
    const doc = compiled.draftDocument!
    const ellipse = doc.primitives.find((p) => p.type === "ellipse")
    expect(ellipse).toBeDefined()
    if (!ellipse || ellipse.type !== "ellipse") throw new Error("expected ellipse")
    expect(ellipse.radiusX).toBeCloseTo(Math.sqrt(5), 6)
    expect(ellipse.radiusY).toBeCloseTo(2, 6)

    const points = doc.primitives.filter((p) => p.type === "point")
    const f1 = points.find((p) => p.label === "F₁")!
    const f2 = points.find((p) => p.label === "F₂")!
    const pM = points.find((p) => p.label === "M")!
    expect(Math.hypot(f1.x - f2.x, f1.y - f2.y)).toBeCloseTo(2, 6)
    expect(conicResidualAt(ellipse, pM)!.residual).toBeLessThan(1e-9)
    expect(built.summary.infeasibleConstraints.length).toBeGreaterThan(0)
  })

  it("constructs orthogonal-foci point P on ellipse when c >= b (PF₁⊥PF₂ feasible)", () => {
    const prompt = "已知 F₁，F₂ 是椭圆 C：x²/a² + y²/b² = 1 (a>b>0) 的两个焦点，|F₁F₂|=6，M(√13, 0) 为 C 上一点，P 为 C 上一点且 PF₁⊥PF₂。"
    const { built, compiled } = compileConicPlan(prompt)
    expect(compiled.ok).toBe(true)
    expect(built.summary.infeasibleConstraints).toHaveLength(0)
    const doc = compiled.draftDocument!
    const ellipse = doc.primitives.find((p) => p.type === "ellipse")!
    if (ellipse.type !== "ellipse") throw new Error("expected ellipse")
    const points = doc.primitives.filter((p) => p.type === "point")
    const f1 = points.find((p) => p.label === "F₁")!
    const f2 = points.find((p) => p.label === "F₂")!
    const pP = points.find((p) => p.label === "P")!
    expect(pP).toBeDefined()
    expect(conicResidualAt(ellipse, pP)!.residual).toBeLessThan(1e-9)
    const v1 = { x: f1.x - pP.x, y: f1.y - pP.y }
    const v2 = { x: f2.x - pP.x, y: f2.y - pP.y }
    expect(v1.x * v2.x + v1.y * v2.y).toBeCloseTo(0, 6)
  })

  it("constructs JT-P07 fitted ellipse x²/4+y²=1 through A(1/2,√15/4) & B(2,0) with line x=3 points E, F", () => {
    const prompt = "已知对称轴都在坐标轴上的椭圆 C 过点 A(1/2, √15/4) 与点 B(2, 0)，过点 (1, 0) 的直线 l 与椭圆 C 交于 P，Q 两点，直线 BP，BQ 分别交直线 x=3 于 E，F 两点。（1）求椭圆 C 的标准方程；（2）向量PE·向量QF 是否存在最小值？若存在，求出最小值；若不存在，请说明理由。"
    const { compiled } = compileConicPlan(prompt)
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).not.toBe("failed")
    expect(compiled.diagramVerification?.checks.some((c) => c.kind === "pointOnConic" && c.status === "passed")).toBe(true)
    const doc = compiled.draftDocument!
    const ellipse = doc.primitives.find((p) => p.type === "ellipse")
    expect(ellipse).toBeDefined()
    if (!ellipse || ellipse.type !== "ellipse") throw new Error("expected ellipse")
    expect(ellipse.radiusX).toBeCloseTo(2, 6)
    expect(ellipse.radiusY).toBeCloseTo(1, 6)

    const points = doc.primitives.filter((p) => p.type === "point")
    for (const label of ["A", "B", "P", "Q", "E", "F"]) {
      expect(points.some((p) => p.label === label)).toBe(true)
    }
    const pE = points.find((p) => p.label === "E")!
    const pF = points.find((p) => p.label === "F")!
    expect(pE.x).toBeCloseTo(3, 6)
    expect(pF.x).toBeCloseTo(3, 6)
  })

  it("constructs JT-P08 locus x²/4+y²/3=1 (x≠0) with vector split EC=2CF", () => {
    const prompt = "已知两点 A(0, √3)，B(0, -√3)。曲线 G 上的动点 P(x, y) 使得直线 PA、PB 的斜率之积为 -3/4。（Ⅰ）求 G 的方程；（Ⅱ）过点 C(0, -1) 的直线与 G 相交于 E、F 两点，且 向量EC=2向量CF，求直线 EF 的方程。"
    const { built, compiled } = compileConicPlan(prompt)
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    const doc = compiled.draftDocument!
    const ellipse = doc.primitives.find((p) => p.type === "ellipse")
    expect(ellipse).toBeDefined()
    if (!ellipse || ellipse.type !== "ellipse") throw new Error("expected ellipse")
    expect(ellipse.radiusX).toBeCloseTo(2, 6)
    expect(ellipse.radiusY).toBeCloseTo(Math.sqrt(3), 6)
    expect(built.summary.domainExclusions).toContain("x≠0")

    const points = doc.primitives.filter((p) => p.type === "point")
    const pE = points.find((p) => p.label === "E")!
    const pF = points.find((p) => p.label === "F")!
    const pC = points.find((p) => p.label === "C")!
    expect(Math.abs(pE.x)).toBeGreaterThan(1e-3)
    expect(Math.abs(pF.x)).toBeGreaterThan(1e-3)
    expect(conicResidualAt(ellipse, pE)!.residual).toBeLessThan(1e-9)
    expect(conicResidualAt(ellipse, pF)!.residual).toBeLessThan(1e-9)
    expect(pC.x - pE.x).toBeCloseTo(2 * (pF.x - pC.x), 6)
    expect(pC.y - pE.y).toBeCloseTo(2 * (pF.y - pC.y), 6)
  })

  it("handles rotated conic + tangent and discloses underdetermined 示意图 free choice honestly", () => {
    const underdetermined = tryBuildPlanarDrawingPlan("画一个椭圆 C：x²/a²+y²/b²=1 (a>b>0) 及其焦点示意图")
    expect(underdetermined).not.toBeNull()
    if (!underdetermined) throw new Error("expected representative schematic plan")
    expect(underdetermined.summary.kind).toBe("free_choice")
    expect(underdetermined.plan.kind).toBe("plan")
    if (underdetermined.plan.kind === "plan") {
      expect(underdetermined.plan.assumptions?.some((a) => /示意|representative|a=2|free_choice/i.test(a))).toBe(true)
    }

    const rotatedPrompt = "画一个中心在 (1, -1)、半长轴 4、半短轴 2、旋转角 30° 的椭圆，并标记其焦点和切线"
    const { built, compiled } = compileConicPlan(rotatedPrompt, { drawingIntentCheck: false })
    expect(built.summary.kind).toBe("solved")
    expect(compiled.ok).toBe(true)
    const ellipse = compiled.draftDocument!.primitives.find((p) => p.type === "ellipse")
    expect(ellipse).toBeDefined()
    if (!ellipse || ellipse.type !== "ellipse") throw new Error("expected ellipse")
    expect(ellipse.rotation).toBeCloseTo(Math.PI / 6, 6)
  })

  it("routes planar/conic prompts via routeDeterministicProblem without intercepting pure 1D function tasks", () => {
    const routed = routeDeterministicProblem("已知抛物线 C：y²=4x 的顶点为 O，过点 (2, 0) 的直线交 C 于 A，B 两点。")
    expect(routed).not.toBeNull()
    expect(routed!.family).toBe("conics-tangents")

    const fnPrompt = "求 f(x)=x²-4x+3 在 [-1, 5] 上的切线与定积分"
    expect(tryBuildPlanarDrawingPlan(fnPrompt)).toBeNull()
  })
})
