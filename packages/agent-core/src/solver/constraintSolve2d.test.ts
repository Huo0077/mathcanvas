import { describe, expect, it } from "vitest"

import { solveConstraint2d } from "./constraintSolve2d"

describe("constraintSolve2d (2D & function kernel solver)", () => {
  it("solves planar incidence, intersection, collinearity, midpoint, segment ratio, equidistant, perpendicular, and parallel constraints", () => {
    const onLine = solveConstraint2d({
      kind: "point_on_line",
      line: [{ x: 0, y: 1 }, { x: 4, y: 5 }],
      parameter: 0.25
    })
    expect(onLine.status).toBe("solved")
    expect(onLine.constraintStatus).toBe("satisfied")
    expect(onLine.roots[0]?.point).toEqual({ x: 1, y: 2 })
    expect(onLine.residual).toBeLessThan(1e-9)

    const intersection = solveConstraint2d({
      kind: "line_intersection",
      first: [{ x: 0, y: 0 }, { x: 4, y: 4 }],
      second: [{ x: 0, y: 4 }, { x: 4, y: 0 }]
    })
    expect(intersection.status).toBe("solved")
    expect(intersection.constraintStatus).toBe("satisfied")
    expect(intersection.roots[0]?.point?.x).toBeCloseTo(2, 9)
    expect(intersection.roots[0]?.point?.y).toBeCloseTo(2, 9)

    const collinearOk = solveConstraint2d({
      kind: "collinear",
      points: [{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 3, y: 6 }]
    })
    expect(collinearOk.constraintStatus).toBe("satisfied")

    const collinearBad = solveConstraint2d({
      kind: "collinear",
      points: [{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 3, y: 7 }]
    })
    expect(collinearBad.constraintStatus).toBe("violated")

    const mid = solveConstraint2d({
      kind: "midpoint",
      a: { x: 1, y: 3 },
      b: { x: 5, y: 7 }
    })
    expect(mid.status).toBe("solved")
    expect(mid.roots[0]?.point).toEqual({ x: 3, y: 5 })

    const ratio = solveConstraint2d({
      kind: "segment_ratio",
      a: { x: 0, y: 0 },
      b: { x: 6, y: 3 },
      ratio: 2,
      mode: "ap_to_pb",
      splitBetween: true
    })
    expect(ratio.status).toBe("solved")
    expect(ratio.roots[0]?.point?.x).toBeCloseTo(4, 9)
    expect(ratio.roots[0]?.point?.y).toBeCloseTo(2, 9)

    const eqDist = solveConstraint2d({
      kind: "equal_distance",
      targets: [{ x: 0, y: 0 }, { x: 4, y: 0 }],
      candidate: { x: 2, y: 5 }
    })
    expect(eqDist.constraintStatus).toBe("satisfied")
    expect(eqDist.residual).toBeCloseTo(0, 9)

    const perp = solveConstraint2d({
      kind: "perpendicular",
      line: [{ x: 0, y: 0 }, { x: 2, y: 2 }],
      throughPoint: { x: 1, y: 3 }
    })
    expect(perp.status).toBe("solved")
    expect(perp.roots[0]?.slope).toBeCloseTo(-1, 9)

    const para = solveConstraint2d({
      kind: "parallel",
      line: [{ x: 0, y: 0 }, { x: 2, y: 4 }],
      throughPoint: { x: 1, y: 5 }
    })
    expect(para.status).toBe("solved")
    expect(para.roots[0]?.slope).toBeCloseTo(2, 9)
  })

  it("solves circle/ellipse/hyperbola/parabola-line intersections with branch selection and rejects disjoint lines", () => {
    const ellipseHit = solveConstraint2d({
      kind: "conic_line_intersection",
      conic: {
        type: "ellipse",
        id: "e1",
        label: "E",
        center: { x: 0, y: 0 },
        radiusX: 2,
        radiusY: 1,
        rotation: 0
      },
      line: { a: { x: 0, y: 0 }, b: { x: 4, y: 2 } },
      branchPreference: "positive_x"
    })
    expect(["solved", "multiple_branches"]).toContain(ellipseHit.status)
    expect(ellipseHit.roots).toHaveLength(2)
    expect(ellipseHit.selectedBranch).toBe(0)
    expect(ellipseHit.roots[0]!.point!.x).toBeGreaterThan(0)
    expect(ellipseHit.residual).toBeLessThan(1e-6)
    expect(ellipseHit.constraintStatus).toBe("satisfied")

    const hyperbolaHit = solveConstraint2d({
      kind: "conic_line_intersection",
      conic: {
        type: "hyperbola",
        id: "h1",
        label: "H",
        center: { x: 0, y: 0 },
        radiusX: 2,
        radiusY: 1,
        axis: "x"
      },
      line: { a: { x: 0, y: 0 }, b: { x: 4, y: 1 } },
      branchPreference: "negative_x"
    })
    expect(["solved", "multiple_branches"]).toContain(hyperbolaHit.status)
    expect(hyperbolaHit.roots[0]!.point!.x).toBeLessThan(0)

    const parabolaHit = solveConstraint2d({
      kind: "conic_line_intersection",
      conic: {
        type: "parabola",
        id: "p1",
        label: "P",
        vertex: { x: 0, y: 0 },
        focalParameter: 2,
        axis: "x"
      },
      line: { a: { x: 1, y: -3 }, b: { x: 1, y: 3 } }
    })
    expect(parabolaHit.roots).toHaveLength(2)
    expect(parabolaHit.residual).toBeLessThan(1e-6)

    const circleMiss = solveConstraint2d({
      kind: "conic_line_intersection",
      conic: {
        type: "circle",
        id: "c1",
        label: "C",
        center: { x: 0, y: 0 },
        radius: 1
      },
      line: { a: { x: -3, y: 5 }, b: { x: 3, y: 5 } }
    })
    expect(circleMiss.status).toBe("infeasible")
    expect(circleMiss.constraintStatus).toBe("inconsistent")
    expect(circleMiss.roots).toEqual([])
  })

  it("evaluates function domains, tangents at x, external-point tangents, common tangents, and blocks empty/invalid domains", () => {
    const validDomain = solveConstraint2d({
      kind: "function_domain",
      expression: "ln(x)",
      domain: [0.5, 4]
    })
    expect(validDomain.status).toBe("solved")
    expect(validDomain.domainStatus).toBe("valid")

    const emptyDomain = solveConstraint2d({
      kind: "function_domain",
      expression: "ln(x)",
      domain: [-4, -0.5]
    })
    expect(emptyDomain.status).toBe("infeasible")
    expect(emptyDomain.domainStatus).toBe("empty_domain")
    expect(emptyDomain.constraintStatus).toBe("inconsistent")

    const tangentAt = solveConstraint2d({
      kind: "tangent_at_x",
      expression: "x^2",
      domain: [-5, 5],
      x: 1
    })
    expect(tangentAt.status).toBe("solved")
    expect(tangentAt.roots[0]?.slope).toBeCloseTo(2, 6)
    expect(tangentAt.roots[0]?.intercept).toBeCloseTo(-1, 6)

    const extTangent = solveConstraint2d({
      kind: "tangent_from_point",
      expression: "x^2",
      domain: [-4, 4],
      point: { x: 0, y: -1 }
    })
    expect(["solved", "multiple_branches"]).toContain(extTangent.status)
    expect(extTangent.roots.length).toBe(2)
    expect(extTangent.residual).toBeLessThan(1e-4)

    const common = solveConstraint2d({
      kind: "common_tangent",
      firstExpression: "x^2",
      secondExpression: "(x - 2)^2 + 1",
      firstDomain: [-3, 3],
      secondDomain: [-1, 5]
    })
    expect(common.status).toBe("solved")
    expect(common.roots.length).toBeGreaterThanOrEqual(1)
    expect(common.residual).toBeLessThan(1e-3)
  })

  it("extracts conic foci and eccentricity both numerically and symbolically, rejecting invalid eccentricity", () => {
    const fociOk = solveConstraint2d({
      kind: "conic_foci_eccentricity",
      conic: {
        type: "ellipse",
        id: "e2",
        label: "E2",
        center: { x: 0, y: 0 },
        radiusX: 5,
        radiusY: 3,
        rotation: 0
      }
    })
    expect(fociOk.status).toBe("solved")
    expect(fociOk.foci).toHaveLength(2)
    expect(fociOk.eccentricity).toBeCloseTo(0.8, 9)

    const symOk = solveConstraint2d({
      kind: "conic_foci_eccentricity",
      symbolicEquation: "x^2/a^2 + y^2/b^2 = 1",
      metrics: [
        { kind: "majorAxisLength", value: 10 },
        { kind: "focalLength", value: 8 }
      ],
      extraDomains: ["a > b > 0"]
    })
    expect(symOk.status).toBe("solved")
    expect(symOk.eccentricity).toBeCloseTo(0.8, 9)
    expect(symOk.foci).toHaveLength(2)

    const invalidEcc = solveConstraint2d({
      kind: "conic_foci_eccentricity",
      symbolicEquation: "x^2/a^2 + y^2/b^2 = 1",
      metrics: [
        { kind: "majorAxisLength", value: 4 },
        { kind: "eccentricity", value: 1.5 }
      ],
      extraDomains: ["a > b > 0"]
    })
    expect(invalidEcc.status).toBe("infeasible")
    expect(invalidEcc.constraintStatus).toBe("inconsistent")
  })

  it("handles degenerate / parallel lines and collinearity counterexamples cleanly", () => {
    const parallelLines = solveConstraint2d({
      kind: "line_intersection",
      first: [{ x: 0, y: 0 }, { x: 2, y: 2 }],
      second: [{ x: 0, y: 3 }, { x: 2, y: 5 }]
    })
    expect(parallelLines.status).toBe("infeasible")
    expect(parallelLines.constraintStatus).toBe("inconsistent")

    const zeroLen = solveConstraint2d({
      kind: "point_on_line",
      line: [{ x: 1, y: 1 }, { x: 1, y: 1 }],
      parameter: 0.5
    })
    expect(zeroLen.status).toBe("degenerate")
    expect(zeroLen.constraintStatus).toBe("inconsistent")
  })
})
