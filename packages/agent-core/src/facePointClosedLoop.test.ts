import { createEmptyDocument } from "@draw/dsl"
import { commitPatch, compileAction, createIdAllocator, resolveBoundPoint3, type ActionContext, type DraftAction } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { parseDraftAction } from "./schemas"

function context(document: ReturnType<typeof createEmptyDocument>): ActionContext {
  return {
    targetDocument: document,
    targetWorkspace: document.workspace,
    orderedSelection: [],
    capabilityRevision: "face-point-closed-loop.1",
    idAllocator: createIdAllocator(document.primitives.map((primitive) => primitive.id))
  }
}

function apply(document: ReturnType<typeof createEmptyDocument>, operations: ReturnType<typeof compileAction>["operations"]) {
  return operations.reduce((current, operation) => {
    const result = commitPatch(current, operation)
    expect(result.error).toBeUndefined()
    return result.document
  }, document)
}

describe("dynamic.create_face_point real agent-to-document loop", () => {
  it("parses the tool payload, compiles it, commits it, and resolves the live point", () => {
    let document = createEmptyDocument("geometry3d")
    const facePlan = {
      actionId: "solid.create_face",
      actionKey: "closed-loop-face",
      factIds: [],
      inputs: { alias: "face", vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 8, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }], vertexNames: ["A", "B", "C", "D"] }
    } as unknown as DraftAction
    const faceResult = compileAction(facePlan, context(document))
    expect(faceResult.diagnostics).toEqual([])
    document = apply(document, faceResult.operations)
    const face = document.primitives.find((primitive) => primitive.type === "face3")
    expect(face).toBeDefined()

    const parsed = parseDraftAction({
      actionId: "dynamic.create_face_point",
      actionKey: "closed-loop-point",
      factIds: [],
      inputs: {
        alias: "P",
        face: { scope: "scene", ref: { documentId: document.metadata.id, entityId: face!.id } },
        uv: [6, 3]
      }
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const compiled = compileAction(parsed.value, context(document))
    expect(compiled.diagnostics).toEqual([])
    document = apply(document, compiled.operations)
    const point = document.primitives.find(
      (primitive): primitive is Extract<typeof document.primitives[number], { type: "point3" }> =>
        primitive.type === "point3" && primitive.label === "P"
    )
    expect(point).toBeDefined()
    if (!point) return
    expect(point.binding).toMatchObject({ kind: "onFace", faceId: face!.id, uv: [6, 3] })
    expect(resolveBoundPoint3(point, new Map(document.primitives.map((primitive) => [primitive.id, primitive])), document.parameters)).toEqual({ x: 6, y: 3, z: 0 })
  })
})


