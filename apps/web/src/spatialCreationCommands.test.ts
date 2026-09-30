import { createEmptyDocument, type GeometryDocument, type Point3Primitive } from "@draw/dsl"
import { commitTransaction } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { commitSpatialCreation } from "./spatialCreationCommands"
import { useSceneStore } from "./store"
import type { SpatialCreationSession } from "./spatialCreationSession"

function point(id: string, x: number, y: number, z: number): Point3Primitive {
  return { id, type: "point3", position: { x, y, z }, binding: { kind: "free" }, label: id }
}
function scene(...points: Point3Primitive[]): GeometryDocument {
  return { ...createEmptyDocument("geometry3d"), primitives: points }
}
function session(tool: SpatialCreationSession["tool"], ...anchors: SpatialCreationSession["anchors"]): SpatialCreationSession {
  return { tool, anchors }
}
const A = { position: { x: 0, y: 0, z: 0 } }
const B = { position: { x: 3, y: 0, z: 0 } }
const C = { position: { x: 0, y: 3, z: 0 } }

describe("atomic 3D drawing commands", () => {
  it("builds two points and one segment in one valid document transaction", () => {
    const document = scene()
    const result = commitSpatialCreation(document, session("segment3", A, B))
    if ("error" in result) throw new Error(result.error)
    expect(result.operations).toHaveLength(1)
    const committed = commitTransaction({ base: document, operations: result.operations })
    expect(committed.errors).toEqual([])
    expect(committed.diff.added).toEqual(["point3-1", "point3-2", "segment3-1"])
    expect(committed.document.primitives[2]).toMatchObject({ type: "segment3", pointIds: ["point3-1", "point3-2"] })
    expect(result.selectedId).toBe("segment3-1")
  })

  it("reuses an existing point rather than adding an overlapping copy", () => {
    const document = scene(point("point3-1", 0, 0, 0))
    const result = commitSpatialCreation(document, session("line3", { ...A, pointId: "point3-1" }, B))
    if ("error" in result) throw new Error(result.error)
    const committed = commitTransaction({ base: document, operations: result.operations })
    expect(committed.errors).toEqual([])
    expect(committed.diff.added).toEqual(["point3-2", "line3-1"])
    expect(committed.document.primitives.at(-1)).toMatchObject({ type: "line3", definition: { kind: "throughPoints", pointIds: ["point3-1", "point3-2"] } })
  })

  it("rejects three collinear points without adding any points", () => {
    const document = scene()
    const result = commitSpatialCreation(document, session("plane3", A, B, { position: { x: 6, y: 0, z: 0 } }))
    expect(result).toHaveProperty("error")
    expect(document.primitives).toEqual([])
  })

  it("rejects non-coplanar polygon faces and missing references before commit", () => {
    expect(commitSpatialCreation(scene(), session("face3", A, B, C, { position: { x: 0, y: 0, z: 2 } }))).toHaveProperty("error")
    expect(commitSpatialCreation(scene(), session("segment3", { ...A, pointId: "deleted" }, B))).toHaveProperty("error")
  })

  it("selects an existing point instead of creating another point on it", () => {
    const document = scene(point("point3-1", 0, 0, 0))
    const result = commitSpatialCreation(document, session("point3", { ...A, pointId: "point3-1" }))
    expect(result).toEqual({ operations: [], selectedId: "point3-1" })
  })
  it("undoes the whole drawing gesture in one step through the real scene store", () => {
    const document = scene()
    useSceneStore.setState({ document, workspaceDocuments: { geometry3d: document }, history: [], future: [], error: null })
    const result = commitSpatialCreation(document, session("segment3", A, B))
    if ("error" in result) throw new Error(result.error)
    useSceneStore.getState().applyBatch(result.operations)
    expect(useSceneStore.getState().history).toHaveLength(1)
    expect(useSceneStore.getState().document.primitives).toHaveLength(3)
    useSceneStore.getState().undo()
    expect(useSceneStore.getState().document.primitives).toEqual([])
  })
  it("creates a single point with the next available classroom label", () => {
    const document = scene(point("point3-1", 8, 8, 8))
    const result = commitSpatialCreation(document, session("point3", B))
    if ("error" in result) throw new Error(result.error)
    expect(commitTransaction({ base: document, operations: result.operations }).document.primitives.at(-1)).toMatchObject({ id: "point3-2", type: "point3", position: B.position, label: "A" })
  })
})