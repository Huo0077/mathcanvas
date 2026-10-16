import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { compileActions } from "./index"
import { commitPatch } from "../patches"
import type { ActionContext, DraftAction, IdAllocator } from "./types"

function allocator(): IdAllocator {
  return { allocate: (_kind, alias) => `${alias}-id` }
}

function action(progress: number): DraftAction {
  return {
    actionId: "solid.unfold",
    actionKey: "unfold",
    factIds: [],
    inputs: {
      target: { documentId: "doc-1", entityId: "solid-1" },
      progress
    }
  } as unknown as DraftAction
}

function context(document = createEmptyDocument("geometry3d")): ActionContext {
  return {
    targetDocument: document,
    targetWorkspace: "geometry3d",
    orderedSelection: [],
    capabilityRevision: "test.1",
    idAllocator: allocator()
  }
}

describe("solid.unfold", () => {
  it("updates a real polyhedron's persisted unfold progress through the action compiler", () => {
    const document = createEmptyDocument("geometry3d")
    document.metadata.id = "doc-1"
    document.primitives.push(
      { id: "v0", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "v1", type: "point3", position: { x: 2, y: 0, z: 0 } },
      { id: "v2", type: "point3", position: { x: 0, y: 2, z: 0 } },
      { id: "v3", type: "point3", position: { x: 0, y: 0, z: 2 } },
      { id: "e01", type: "edge3", pointIds: ["v0", "v1"] },
      { id: "e02", type: "edge3", pointIds: ["v0", "v2"] },
      { id: "e03", type: "edge3", pointIds: ["v0", "v3"] },
      { id: "e12", type: "edge3", pointIds: ["v1", "v2"] },
      { id: "e13", type: "edge3", pointIds: ["v1", "v3"] },
      { id: "e23", type: "edge3", pointIds: ["v2", "v3"] },
      { id: "f012", type: "face3", pointIds: ["v0", "v1", "v2"] },
      { id: "f013", type: "face3", pointIds: ["v0", "v1", "v3"] },
      { id: "f023", type: "face3", pointIds: ["v0", "v2", "v3"] },
      { id: "f123", type: "face3", pointIds: ["v1", "v2", "v3"] },
      {
        id: "solid-1",
        type: "polyhedron3",
        vertexIds: ["v0", "v1", "v2", "v3"],
        edgeIds: ["e01", "e02", "e03", "e12", "e13", "e23"],
        faceIds: ["f012", "f013", "f023", "f123"]
      }
    )

    const result = compileActions(document, [action(0.75)], context(document))

    expect(result.diagnostics).toEqual([])
    expect(result.operations).toEqual([{
      op: "updatePrimitive",
      id: "solid-1",
      patch: { unfoldProgress: 0.75 }
    }])

    const committed = commitPatch(document, result.operations[0]!)
    expect(committed.error).toBeUndefined()
    expect(committed.changed).toBe(true)
    const persisted = committed.document.primitives.find((primitive) => primitive.id === "solid-1")
    expect(persisted).toMatchObject({ type: "polyhedron3", unfoldProgress: 0.75 })
  })

  it("rejects non-polyhedra and out-of-range progress without producing an operation", () => {
    const document = createEmptyDocument("geometry3d")
    document.metadata.id = "doc-1"
    document.primitives.push({ id: "cube-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } })

    const wrongType = compileActions(document, [action(0.5)], context(document))
    expect(wrongType.operations).toEqual([])
    expect(wrongType.diagnostics[0]?.code).toBe("unfold_target_invalid")

    const invalidProgress = compileActions(document, [action(1.5)], context(document))
    expect(invalidProgress.operations).toEqual([])
    expect(invalidProgress.diagnostics[0]?.code).toBe("unfold_progress_invalid")
  })
})
