import { describe, expect, it } from "vitest"

import { conicResidualAt, intersectLineWithConic } from "./conic-line"
import { EXACT_FORM_POLICY_VERSION, exactFormOf } from "./exact-forms"
import {
  characteristicScale,
  classifyUncertaintyInterval,
  NUMERIC_POLICY_VERSION,
  normalizedLengthResidual,
  normalizedParallelResidual,
  normalizedPerpendicularResidual,
  normalizedPlaneDistanceResidual
} from "./numeric"
import { buildFromPoints } from "./solid-builders"

describe("T11 scale-aware versioned numeric policy", () => {
  it("exposes explicit policy versions and rejects NaN / Infinity / zero normal or scale as degenerate", () => {
    expect(NUMERIC_POLICY_VERSION).toBe("num-policy-v1")
    expect(EXACT_FORM_POLICY_VERSION).toBe("exact-form-v1")

    expect(normalizedPerpendicularResidual({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }).status).toBe("degenerate")
    expect(normalizedPerpendicularResidual({ x: Number.NaN, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }).status).toBe("degenerate")
    expect(normalizedParallelResidual({ x: 1, y: 0, z: 0 }, { x: Number.POSITIVE_INFINITY, y: 0, z: 0 }).status).toBe("degenerate")
    expect(normalizedPlaneDistanceResidual({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1).status).toBe("degenerate")
    expect(normalizedLengthResidual(1, 1, 0).status).toBe("degenerate")

    const nonFiniteExact = exactFormOf(Number.NaN)
    expect(nonFiniteExact.residual).toBeNull()
  })

  it("produces invariant dimensionless perpendicular/parallel/length/plane residuals across 1e-3, 1, 1e3 and rigid motions", () => {
    const scales = [1e-3, 1, 1e3]
    for (const s of scales) {
      const u = { x: 3 * s, y: 4 * s, z: 0 }
      const vPerp = { x: -4 * s, y: 3 * s, z: 0 }
      const vPar = { x: 6 * s, y: 8 * s, z: 0 }
      const perp = normalizedPerpendicularResidual(u, vPerp)
      const par = normalizedParallelResidual(u, vPar)
      expect(perp.status).toBe("satisfied")
      expect(perp.residual).toBeLessThan(1e-11)
      expect(par.status).toBe("satisfied")
      expect(par.residual).toBeLessThan(1e-11)

      const len = normalizedLengthResidual(5 * s, 5 * s, characteristicScale([5 * s]))
      expect(len.status).toBe("satisfied")
      expect(len.residual).toBeLessThan(1e-11)

      const plane = normalizedPlaneDistanceResidual(
        { x: 10 * s, y: -2 * s, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 2 * s },
        s
      )
      expect(plane.status).toBe("satisfied")
      expect(plane.residual).toBe(0)
    }
  })

  it("returns unknown when error band straddles the decision threshold instead of forcing pass", () => {
    expect(classifyUncertaintyInterval(0.9e-6, 0.5e-6, 1e-6)).toBe("unknown")
    expect(classifyUncertaintyInterval(0.1e-6, 0.2e-6, 1e-6)).toBe("satisfied")
    expect(classifyUncertaintyInterval(2.0e-6, 0.2e-6, 1e-6)).toBe("violated")
  })
})

describe("T11 conic-line & solid-builders scale stability (1e-3, 1, 1e3)", () => {
  it("distinguishes tangent, near-secant (1e-4 relative), and disjoint lines across 1e-3, 1, 1e3 with unit-step line parameterization", () => {
    for (const s of [1e-3, 1, 1e3]) {
      const ellipse = { id: `e-${s}`, type: "ellipse" as const, center: { x: 0, y: 0 }, radiusX: 2 * s, radiusY: s }
      // Even when line is parameterized with step size ~ 1 instead of s, tiny conic tangent must remain exact tangent
      // and shallow secant cutting 5e-5 inside top vertex y = s*(1 - 5e-5) must NOT collapse to tangent at scale 1e-3!
      const tangent = intersectLineWithConic(
        { a: { x: -1, y: s }, b: { x: 1, y: s } },
        ellipse
      )
      expect(tangent.kind, `tangent at scale ${s}`).toBe("tangent")

      const shallowSecant = intersectLineWithConic(
        { a: { x: -1, y: s * (1 - 1e-4) }, b: { x: 1, y: s * (1 - 1e-4) } },
        ellipse
      )
      expect(shallowSecant.kind, `shallow secant at scale ${s}`).toBe("secant")

      const disjoint = intersectLineWithConic(
        { a: { x: -1, y: s * (1 + 1e-4) }, b: { x: 1, y: s * (1 + 1e-4) } },
        ellipse
      )
      expect(disjoint.kind, `disjoint at scale ${s}`).toBe("none")

      const onCurveRes = conicResidualAt(ellipse, { x: 2 * s, y: 0 })
      expect(onCurveRes).not.toBeNull()
      expect(Math.abs(onCurveRes?.value ?? 1)).toBeLessThan(1e-12)
      const offCurveRes = conicResidualAt(ellipse, { x: 0, y: 2 * s })
      expect(Math.abs(offCurveRes?.value ?? 0)).toBeCloseTo(3, 9)
    }
  })

  it("buildFromPoints rejects flat 1e-3 tetrahedron and accepts valid scaled tetrahedra identically across 1e-3, 1, 1e3", () => {
    let counter = 0
    const context = { allocateId: (ns: string) => `${ns}-${++counter}` }
    const faces = [[0, 1, 2], [0, 3, 1], [1, 3, 2], [2, 3, 0]]

    for (const s of [1e-3, 1, 1e3]) {
      const valid = buildFromPoints(
        {
          vertices: [
            { x: 0, y: 0, z: 0 },
            { x: s, y: 0, z: 0 },
            { x: 0, y: s, z: 0 },
            { x: 0, y: 0, z: s }
          ],
          faces
        },
        context
      )
      expect(valid.diagnostics, `valid scale ${s}`).toEqual([])

      // Nearly flat (z = 1e-11 * s relative; at s=1e-3 -> 1e-14, and at s=1e-3 with z=1e-11 -> 1e-8 relative, vs fixed 1e-10!)
      const flat = buildFromPoints(
        {
          vertices: [
            { x: 0, y: 0, z: 0 },
            { x: s, y: 0, z: 0 },
            { x: 0, y: s, z: 0 },
            { x: 0.2 * s, y: 0.2 * s, z: 1e-12 * s }
          ],
          faces
        },
        context
      )
      expect(flat.diagnostics.some((d) => d.code === "degenerate-volume"), `flat scale ${s}`).toBe(true)
    }
  })
})
