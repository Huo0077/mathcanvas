import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { compilePlan } from "../planCompiler"
import { compileConstructionDag, deriveRequiredDrawingIntent } from "../drawingIntent"
import { constructTetrahedronBranches } from "./tetrahedron"
import { validateAuxiliaryHosts } from "./witnessSearch"

describe("P4 / T09 parameterized solid contracts, mirror branches & host checks", () => {
  it("enumerates and filters tetrahedron mirror branches explicitly with closed topology & edge residuals", () => {
    const both = constructTetrahedronBranches({ ab: 3, ac: 3, bc: 3, pa: 3, pb: 3, pc: 3 }, { sideFilter: "both" })
    expect(both).toHaveLength(2)
    expect(both.map((b) => b.branch)).toEqual(["positive", "negative"])
    expect(both[0]!.points.p.z).toBeGreaterThan(0)
    expect(both[1]!.points.p.z).toBeLessThan(0)
    for (const branch of both) {
      expect(branch.topologyValid).toBe(true)
      expect(branch.maxResidual).toBeLessThan(1e-12)
    }

    const negOnly = constructTetrahedronBranches(
      { ab: 3, ac: 3, bc: 3, pa: 3, pb: 3, pc: 3 },
      { sideFilter: "negative" }
    )
    expect(negOnly).toHaveLength(1)
    expect(negOnly[0]!.branch).toBe("negative")
  })

  it("rejects missing host endpoints on auxiliary points instead of building broken references", () => {
    const valid = validateAuxiliaryHosts(["A", "B", "C", "D"], [
      { name: "E", hostEdge: ["A", "D"], parameter: 0.4, source: "AE=2/5 AD", point: { x: 0, y: 2, z: 0 } },
      { name: "F", hostEdge: ["A", "B"], parameter: 0.5, source: "AF=1/2 AB", point: { x: 4, y: 0, z: 0 } }
    ])
    expect(valid.ok).toBe(true)

    const missing = validateAuxiliaryHosts(["A", "B", "C", "D"], [
      { name: "E", hostEdge: ["A", "Z"], parameter: 0.5, source: "AZ中点", point: { x: 0, y: 0, z: 0 } }
    ])
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.diagnostics[0]!.code).toBe("missing_host")
    }
  })

  it("builds verified GK-S02 plan through compilePlan and refuses broken solid topology with no verified draft", () => {
    const prompt = "如图，在以 A，B，C，D，E，F 为顶点的五面体中，四边形 ABCD 与四边形 ADEF 均为等腰梯形，EF∥AD，BC∥AD，AD=4，AB=BC=EF=2，ED=√10，FB=2√3，M 为 AD 的中点。"
    const vertices = [
      { x: -2, y: 0, z: 0 },
      { x: -1, y: Math.sqrt(3), z: 0 },
      { x: 1, y: Math.sqrt(3), z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 1, y: 0, z: 3 },
      { x: -1, y: 0, z: 3 }
    ]
    const validCompiled = compilePlan(
      {
        schemaVersion: "mathcanvas.plan.v1",
        kind: "plan",
        goal: "构造五面体 ABCDEF 及 AD 中点 M",
        factIds: [],
        actions: [
          {
            actionId: "solid.create_polyhedron",
            actionKey: "s03-poly",
            factIds: [],
            inputs: {
              alias: "s03",
              vertexNames: ["A", "B", "C", "D", "E", "F"],
              vertices,
              faces: [[0, 1, 2, 3], [0, 3, 4, 5], [1, 5, 4, 2], [0, 5, 1], [2, 4, 3]]
            }
          },
          {
            actionId: "dynamic.create_bound_point",
            actionKey: "pt-m",
            factIds: [],
            inputs: {
              alias: "M",
              host: { scope: "draft", alias: "s03" },
              hostEdge: { from: "A", to: "D" },
              parameter: 0.5,
              label: "M"
            }
          }
        ]
      },
      { document: createEmptyDocument("geometry3d"), prompt }
    )
    expect(validCompiled.ok).toBe(true)
    expect(validCompiled.diagramVerification?.status).toBe("passed")

    // Now corrupt face winding / non-coplanar vertex -> compilePlan must fail and return draftDocument === null!
    const badVertices = vertices.map((v, i) => (i === 4 ? { ...v, y: 0.5 } : v))
    const brokenCompiled = compilePlan(
      {
        schemaVersion: "mathcanvas.plan.v1",
        kind: "plan",
        goal: "坏拓扑测试",
        factIds: [],
        actions: [
          {
            actionId: "solid.create_polyhedron",
            actionKey: "s03-bad",
            factIds: [],
            inputs: {
              alias: "s03",
              vertexNames: ["A", "B", "C", "D", "E", "F"],
              vertices: badVertices,
              faces: [[0, 1, 2, 3], [0, 3, 4, 5], [1, 5, 4, 2], [0, 5, 1], [2, 4, 3]]
            }
          }
        ]
      },
      { document: createEmptyDocument("geometry3d"), prompt }
    )
    expect(brokenCompiled.ok).toBe(false)
    expect(brokenCompiled.draftDocument).toBeNull()

    const intent = deriveRequiredDrawingIntent({ prompt: "已知直角四棱柱..." })
    const dag = compileConstructionDag(intent.nodes)
    expect(dag.ok).toBe(true)
  })
})
