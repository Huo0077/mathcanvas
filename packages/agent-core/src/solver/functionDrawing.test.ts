import {
  conicResidualAt,
  createDynamicPoint,
  createReactiveGraph,
  differentiabilityAt,
  evaluateFunctionWithDomain,
  evaluateSymbolicDerivative,
  functionGraphEvidence,
  intersectParametricLineWithConic,
  invalidateEvidenceOnDomainChange,
  tangentsFromPoint,
  verifyTangentLine,
  verticalLineConstraint
} from "@draw/geometry-kernel"
import type { Coordinate, HyperbolaPrimitive } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "../diagramObligations"
import { verifyDiagramObligations } from "../diagramVerification"

describe("P4 / T08 functions, derivatives & vertical-host reactive tracking", () => {
  it("f(x)=x² tangent at x=1 gives exact y=2x-1 and rejects non-differentiable corner/unsupported claims", () => {
    const deriv = evaluateSymbolicDerivative("x^2", 1)
    expect(deriv.ok).toBe(true)
    if (!deriv.ok) throw new Error("expected symbolic derivative")
    expect(deriv.value).toBeCloseTo(2, 12)
    const y0 = evaluateFunctionWithDomain("x^2", 1)
    expect(y0.ok).toBe(true)
    if (!y0.ok) throw new Error("expected value")
    const slope = deriv.value
    const intercept = y0.value - slope * 1
    expect(intercept).toBeCloseTo(-1, 12)
    expect(verifyTangentLine("x^2", [-3, 3], { slope, intercept }).tangent).toBe(true)

    const diffCorner = differentiabilityAt("abs(x)", 0, [-2, 2])
    expect(diffCorner.differentiable).toBe(false)
    const unsupported = tangentsFromPoint("abs(x)", [-2, 2], { x: 0.5, y: 0 })
    expect(unsupported.status).toBe("unsupported")
    expect(unsupported.complete).toBe(false)
  })

  it("respects domain discontinuities (1/x at x=0, sqrt(x) on x<0) and rejects x/x cancellation", () => {
    const recip = functionGraphEvidence("1/x", [-3, 3], { steps: 97 })
    expect(recip.breaks.length).toBe(1)
    expect(recip.grade).toBe("plot-only")
    for (const seg of recip.segments) {
      expect(seg[0]!.x * seg[seg.length - 1]!.x).toBeGreaterThan(0)
    }

    const sqrtEv = functionGraphEvidence("sqrt(x)", [-3, 3])
    for (const seg of sqrtEv.segments) {
      for (const p of seg) expect(p.x).toBeGreaterThanOrEqual(0)
    }

    expect(evaluateFunctionWithDomain("x/x", 0).ok).toBe(false)
  })

  it("JT-P02: P(t)=(-1,t) stays locked to vertical host x=-1 across 10 drags and recomputes M, N -> fixed (-4, 0)", () => {
    const hyperbola: HyperbolaPrimitive = { id: "hyp-jtp02", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 2, radiusY: 4, axis: "x" }
    const a1: Coordinate = { x: -2, y: 0 }
    const a2: Coordinate = { x: 2, y: 0 }
    const host = verticalLineConstraint("line-x-neg1", -1, { mathDomain: [-50, 50], displayRange: [-8, 8] })
    const pDyn = createDynamicPoint("P", host, { parameter: 1 })

    expect(host.mathDomain).toEqual([-50, 50])
    expect(host.displayRange).toEqual([-8, 8])

    type NodeVal = Coordinate | { M: Coordinate; N: Coordinate; linePassesFixedPoint: boolean }
    let currentP: Coordinate = pDyn.position

    const reactive = createReactiveGraph<NodeVal>([
      { id: "P", dependsOn: [], compute: () => currentP },
      {
        id: "MN",
        dependsOn: ["P"],
        compute: (inputs) => {
          const p = inputs.get("P") as Coordinate
          const intM = intersectParametricLineWithConic(
            { origin: a1, direction: { x: p.x - a1.x, y: p.y - a1.y } },
            hyperbola
          )
          const intN = intersectParametricLineWithConic(
            { origin: a2, direction: { x: p.x - a2.x, y: p.y - a2.y } },
            hyperbola
          )
          if (intM.kind !== "secant" || intN.kind !== "secant") throw new Error("expected secants")
          const M = intM.points.find((pt) => Math.hypot(pt.x - a1.x, pt.y - a1.y) > 1e-6)!
          const N = intN.points.find((pt) => Math.hypot(pt.x - a2.x, pt.y - a2.y) > 1e-6)!
          const fixed: Coordinate = { x: -4, y: 0 }
          const cross = (M.x - fixed.x) * (N.y - fixed.y) - (M.y - fixed.y) * (N.x - fixed.x)
          const scale = Math.max(1, Math.hypot(M.x - fixed.x, M.y - fixed.y) * Math.hypot(N.x - fixed.x, N.y - fixed.y))
          return { M, N, linePassesFixedPoint: Math.abs(cross) / scale < 1e-9 }
        }
      }
    ])

    // Drag P across 10 different parameters (avoiding asymptote t = +-2, +-6; including points outside initial displayRange [-8, 8]!)
    const dragTargets = [-12, -9.5, -4.5, -3, -1.2, 0.5, 1.5, 3.2, 5.1, 10.5]
    for (const yTarget of dragTargets) {
      // Simulate user pointer attempt slightly off x=-1 (host must enforce x=-1 strictly!)
      const move = pDyn.moveTo({ x: -1 + 0.4 * Math.sin(yTarget), y: yTarget })
      expect(move.converged).toBe(true)
      expect(pDyn.position.x).toBeCloseTo(-1, 12)
      expect(pDyn.position.y).toBeCloseTo(yTarget, 12)

      currentP = pDyn.position
      reactive.setValue("P", currentP)
      const report = reactive.update(["P"])
      expect(report.errors.size).toBe(0)
      expect(report.recomputed).toContain("MN")

      const derived = reactive.value("MN") as { M: Coordinate; N: Coordinate; linePassesFixedPoint: boolean }
      expect(conicResidualAt(hyperbola, derived.M)!.residual).toBeLessThan(1e-11)
      expect(conicResidualAt(hyperbola, derived.N)!.residual).toBeLessThan(1e-11)
      expect(derived.linePassesFixedPoint).toBe(true)
    }
  })

  it("separates render window from math domain and invalidates stale curve/tangent evidence on domain update", () => {
    const evidence = functionGraphEvidence("sin(x)", [-Math.PI, Math.PI])
    const staleResult = invalidateEvidenceOnDomainChange([-Math.PI, Math.PI], [0, Math.PI], evidence)
    expect(staleResult.stale).toBe(true)

    const obligations = parseDiagramObligations("画函数 f(x)=x^2 在 [-2, 2] 上的图像，并过点 (1, 1) 作切线。")
    expect(obligations.givens.some((g) => g.kind === "functionGraph")).toBe(true)
    expect(verifyDiagramObligations).toBeDefined()
  })
})
