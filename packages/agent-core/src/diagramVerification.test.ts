import { createEmptyDocument } from "@draw/dsl"
import type { Vector3 } from "@draw/geometry-kernel"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { verifyDiagramObligations } from "./diagramVerification"

const prompt = "在三棱锥 A-BCD 中，BD=2，△OCD为等边三角形，AB=AD，O为BD的中点，DE=2EA，平面ABD⊥平面BCD，二面角E-BC-D=45°。求证 OA⊥CD"
const names = ["A", "B", "C", "D", "O", "E"]
// A=(0,0,1) gives the interior dihedral E-BC-D 45°. A=0.64 gives ~32.62°.
function positions(height = 1): Vector3[] {
  return [
    { x: 0, y: 0, z: height },
    { x: -1, y: 0, z: 0 },
    { x: 0.5, y: Math.sqrt(3) / 2, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 1 / 3, y: 0, z: 2 * height / 3 }
  ]
}
function fixture(height = 1, vertexNames: string[] | null = names) {
  const vertices = positions(height)
  const inputs = { alias: "solid", vertices, faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]], ...(vertexNames ? { vertexNames } : {}) }
  const plan: PlanEnvelope = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "画示意图", factIds: [], actions: [{ actionId: "solid.create_polyhedron", actionKey: "solid", factIds: [], inputs }] }
  const candidate = createEmptyDocument("geometry3d")
  candidate.primitives.push(...vertices.map((position, i) => ({ id: `solid-v${i}`, type: "point3" as const, position })))
  candidate.primitives.push({ id: "solid", type: "polyhedron3", vertexIds: vertices.map((_, i) => `solid-v${i}`), edgeIds: [], faceIds: [] })
  return { plan, candidate }
}

describe("verifyDiagramObligations", () => {
  it("accepts a non-unique yet condition-valid static diagram without claiming a general proof", () => {
    const { plan, candidate } = fixture()
    const report = verifyDiagramObligations(parseDiagramObligations(prompt), plan, candidate)
    expect(report.status).toBe("passed")
    expect(report.checks.map((item) => item.status)).toEqual(Array(7).fill("passed"))
    expect(report.checks.map((item) => item.sourceText)).not.toContain("OA⊥CD")
  })

  it("detects the wrong dihedral even when the other six conditions hold", () => {
    const { plan, candidate } = fixture(0.64)
    const report = verifyDiagramObligations(parseDiagramObligations(prompt), plan, candidate)
    expect(report.status).toBe("failed")
    expect(report.checks.filter((item) => item.status === "failed").map((item) => item.kind)).toEqual(["dihedral"])
    expect(report.checks.find((item) => item.kind === "dihedral")).toMatchObject({ expected: 45, actual: expect.closeTo(32.619, 2) })
  })

  it("reports an explicit free point as an example rather than inventing a given length", () => {
    const { plan, candidate } = fixture()
    const set = parseDiagramObligations("在三棱锥A-BCD中，BD=2，任取点A，画一张示意图")
    const report = verifyDiagramObligations(set, plan, candidate)
    expect(report.status).toBe("passed")
    expect(report.sampleValues).toEqual(["自由点 A 采用示例坐标 (0, 0, 1)"])
  })
  it("checks a four-point plane against a three-point plane without dropping a vertex", () => {
    const { plan, candidate } = fixture()
    const parsed = parseDiagramObligations("在三棱锥A-BCD中，平面ABDE⊥平面BCD，画示意图")
    expect(verifyDiagramObligations(parsed, plan, candidate).checks[0].status).toBe("passed")
    const point = candidate.primitives.find((item) => item.id === "solid-v5")
    if (point?.type !== "point3") throw new Error("missing E")
    point.position.y = 1
    expect(verifyDiagramObligations(parsed, plan, candidate).checks[0].status).toBe("unverified")
  })
  it("reads the candidate document, not stale vertices from the model plan", () => {
    const { plan, candidate } = fixture()
    const point = candidate.primitives.find((item) => item.id === "solid-v3")
    if (point?.type !== "point3") throw new Error("missing point")
    point.position.x = 1.5
    const report = verifyDiagramObligations(parseDiagramObligations(prompt), plan, candidate)
    expect(report.checks.find((item) => item.kind === "fixedLength")?.status).toBe("failed")
  })

  it("returns unverified for absent or ambiguous names instead of guessing vertex order", () => {
    for (const vertexNames of [null, ["A", "B", "C", "D", "O", "O"]]) {
      const { plan, candidate } = fixture(1, vertexNames)
      const report = verifyDiagramObligations(parseDiagramObligations(prompt), plan, candidate)
      expect(report.status).toBe("unverified")
      expect(report.checks.some((item) => item.status === "unverified")).toBe(true)
    }
  })

  it("verifies a newly staged solid even when the document already has another solid", () => {
    const { plan, candidate } = fixture()
    const base = createEmptyDocument("geometry3d")
    const existing = { id: "previous", type: "polyhedron3" as const, vertexIds: [], edgeIds: [], faceIds: [] }
    base.primitives.push(existing)
    candidate.primitives.unshift(existing)
    const report = verifyDiagramObligations(parseDiagramObligations(prompt), plan, candidate, base)
    expect(report.status).toBe("passed")
  })
  it("does not interpret an unknown angle condition as a successful empty verification", () => {
    const { plan, candidate } = fixture()
    const report = verifyDiagramObligations(parseDiagramObligations("在△ABC中，∠ABC=60°，画出图形"), plan, candidate)
    expect(report.status).toBe("unverified")
    expect(report.checks[0].sourceText).toBe("∠ABC=60°")
  })
})
