import { describe, expect, it } from "vitest"

import { solveConstraint3d } from "./constraintSolve3d"

describe("constraintSolve3d (3D geometric constraint kernel solver)", () => {
  it("constructs closed right prisms, pyramids, and tetrahedra with named vertices, face rings, and pointRegistry", () => {
    const prism = solveConstraint3d({
      kind: "prism",
      baseVertices: [
        { name: "A", point: { x: 0, y: 0, z: 0 } },
        { name: "B", point: { x: 4, y: 0, z: 0 } },
        { name: "C", point: { x: 4, y: 3, z: 0 } },
        { name: "D", point: { x: 0, y: 3, z: 0 } }
      ],
      topLabels: ["A1", "B1", "C1", "D1"],
      height: 5
    })
    expect(prism.status).toBe("solved")
    expect(prism.constraintStatus).toBe("satisfied")
    expect(prism.topologyValid).toBe(true)
    expect(prism.pointRegistry["B1"]?.z).toBeCloseTo(5, 9)
    expect(prism.faceRings?.length).toBe(6)
    expect(prism.residuals["topologyClosed"]).toBe(0)

    const regPyramid = solveConstraint3d({
      kind: "regular_pyramid",
      baseSide: 4,
      lateralEdge: 5
    })
    expect(regPyramid.status).toBe("solved")
    expect(regPyramid.topologyValid).toBe(true)
    expect(regPyramid.pointRegistry["P"]).toBeDefined()
    expect(regPyramid.residuals["maxLateralEdge"]).toBeLessThan(1e-6)

    const perpPyramid = solveConstraint3d({
      kind: "perpendicular_pyramid",
      apexName: "S",
      baseVertices: [
        { name: "A", point: { x: 0, y: 0, z: 0 } },
        { name: "B", point: { x: 3, y: 0, z: 0 } },
        { name: "C", point: { x: 3, y: 4, z: 0 } },
        { name: "D", point: { x: 0, y: 4, z: 0 } }
      ],
      footName: "A",
      height: 6
    })
    expect(perpPyramid.status).toBe("solved")
    expect(perpPyramid.topologyValid).toBe(true)
    expect(perpPyramid.pointRegistry["S"]).toEqual({ x: 0, y: 0, z: 6 })
    expect(perpPyramid.residuals["perpendicularApex"]).toBeLessThan(1e-9)

    const tetra = solveConstraint3d({
      kind: "tetrahedron",
      names: ["P", "A", "B", "C"],
      ab: 4,
      ac: 5,
      bc: 6,
      pa: 4.5,
      pb: 5,
      pc: 5.5
    })
    expect(tetra.status).toBe("solved")
    expect(tetra.topologyValid).toBe(true)
    expect(Object.keys(tetra.pointRegistry)).toEqual(["P", "A", "B", "C"])
    expect(tetra.residuals["maxEdge"]).toBeLessThan(1e-6)
  })

  it("solves 3D perpendicular foot onto line/plane and edge/face interior ratio points", () => {
    const footLine = solveConstraint3d({
      kind: "perpendicular_foot",
      targetKind: "line",
      point: { x: 2, y: 3, z: 4 },
      line: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      resultName: "H"
    })
    expect(footLine.status).toBe("solved")
    expect(footLine.pointRegistry["H"]).toEqual({ x: 2, y: 0, z: 0 })
    expect(footLine.residuals["orthogonality"]).toBeLessThan(1e-9)

    const footPlane = solveConstraint3d({
      kind: "perpendicular_foot",
      targetKind: "plane",
      point: { x: 1, y: 2, z: 5 },
      planePoints: [
        { x: 0, y: 0, z: 1 },
        { x: 3, y: 0, z: 1 },
        { x: 0, y: 3, z: 1 }
      ],
      resultName: "F"
    })
    expect(footPlane.status).toBe("solved")
    expect(footPlane.pointRegistry["F"]?.z).toBeCloseTo(1, 9)
    expect(footPlane.residuals["onPlane"]).toBeLessThan(1e-9)

    const edgePt = solveConstraint3d({
      kind: "interior_ratio",
      targetKind: "edge",
      anchors: [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 3, z: 9 }
      ],
      ratio: 1 / 3,
      resultName: "M"
    })
    expect(edgePt.status).toBe("solved")
    expect(edgePt.pointRegistry["M"]?.x).toBeCloseTo(2, 9)
    expect(edgePt.pointRegistry["M"]?.y).toBeCloseTo(1, 9)
    expect(edgePt.pointRegistry["M"]?.z).toBeCloseTo(3, 9)
  })

  it("verifies line-plane, plane-plane, coplanar, and closed-topology constraints and rejects counterexamples", () => {
    const linePerpPlane = solveConstraint3d({
      kind: "line_plane_relation",
      relation: "perpendicular",
      line: [{ x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 5 }],
      planePoints: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }]
    })
    expect(linePerpPlane.status).toBe("solved")
    expect(linePerpPlane.constraintStatus).toBe("satisfied")
    expect(linePerpPlane.residuals["relation"]).toBeLessThan(1e-9)

    const lineNotParallel = solveConstraint3d({
      kind: "line_plane_relation",
      relation: "parallel",
      line: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }],
      planePoints: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]
    })
    expect(lineNotParallel.constraintStatus).toBe("violated")

    const planePerp = solveConstraint3d({
      kind: "plane_plane_relation",
      relation: "perpendicular",
      firstPlane: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
      secondPlane: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }]
    })
    expect(planePerp.constraintStatus).toBe("satisfied")

    const nonCoplanar = solveConstraint3d({
      kind: "coplanar",
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 0, y: 2, z: 0 },
        { x: 1, y: 1, z: 2 }
      ]
    })
    expect(nonCoplanar.constraintStatus).toBe("violated")
    expect(nonCoplanar.residuals["coplanar"]).toBeGreaterThan(1)

    const openShell = solveConstraint3d({
      kind: "closed_polyhedron_topology",
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 }
      ],
      faceRings: [
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3]
      ]
    })
    expect(openShell.status).toBe("infeasible")
    expect(openShell.topologyValid).toBe(false)
    expect(openShell.constraintStatus).toBe("inconsistent")

    const badPrism = solveConstraint3d({
      kind: "prism",
      baseVertices: [
        { name: "A", point: { x: 0, y: 0, z: 0 } },
        { name: "B", point: { x: 2, y: 0, z: 0 } },
        { name: "C", point: { x: 0, y: 2, z: 0 } }
      ],
      topLabels: ["A1", "B1", "C1"],
      height: -1
    })
    expect(badPrism.status).toBe("infeasible")
    expect(badPrism.constraintStatus).toBe("inconsistent")
  })
})
