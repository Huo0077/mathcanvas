import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { commitPatch } from "../patches"
import { resolveBoundPoint3 } from "../resolve3d"
import { compileAction, createIdAllocator } from "./index"
import type { ActionContext, DraftAction } from "./types"

const SQUARE = [
  { x: 0, y: 0, z: 0 },
  { x: 8, y: 0, z: 0 },
  { x: 8, y: 4, z: 0 },
  { x: 0, y: 4, z: 0 }
]

function action(partial: Record<string, unknown>): DraftAction {
  return { actionKey: "face-point-test", factIds: [], ...partial } as unknown as DraftAction
}

function context(document: ReturnType<typeof createEmptyDocument>): ActionContext {
  return {
    targetDocument: document,
    targetWorkspace: document.workspace,
    orderedSelection: [],
    capabilityRevision: "test.1",
    idAllocator: createIdAllocator(document.primitives.map((primitive) => primitive.id))
  }
}

function applyAll(document: ReturnType<typeof createEmptyDocument>, operations: ReturnType<typeof compileAction>["operations"]) {
  return operations.reduce((current, operation) => {
    const result = commitPatch(current, operation)
    expect(result.error).toBeUndefined()
    expect(result.changed).toBe(true)
    return result.document
  }, document)
}

function createFaceDocument() {
  const initial = createEmptyDocument("geometry3d")
  const faceResult = compileAction(action({
    actionId: "solid.create_face",
    inputs: { alias: "face", vertices: SQUARE, vertexNames: ["A", "B", "C", "D"] }
  }), context(initial))
  expect(faceResult.diagnostics).toEqual([])
  const document = applyAll(initial, faceResult.operations)
  const face = document.primitives.find((primitive) => primitive.type === "face3")
  expect(face).toBeDefined()
  return { document, faceId: face!.id }
}

describe("dynamic.create_face_point", () => {
  it("creates an onFace point from a real face and resolves coordinates from uv", () => {
    const { document, faceId } = createFaceDocument()
    const result = compileAction(action({
      actionId: "dynamic.create_face_point",
      inputs: { alias: "P", face: { documentId: document.metadata.id, entityId: faceId }, uv: [4, 2], label: "P" }
    }), context(document))

    expect(result.diagnostics).toEqual([])
    const point = result.operations.flatMap((operation) => operation.op === "addPrimitive" ? [operation.primitive] : []).find((primitive) => primitive.type === "point3")
    expect(point).toMatchObject({ type: "point3", binding: { kind: "onFace", faceId, uv: [4, 2] } })
    const committed = applyAll(document, result.operations)
    const committedPoint = committed.primitives.find((primitive) => primitive.id === point!.id)
    expect(committedPoint?.type).toBe("point3")
    expect(resolveBoundPoint3(committedPoint as Extract<typeof committedPoint, { type: "point3" }>, new Map(committed.primitives.map((primitive) => [primitive.id, primitive])), committed.parameters)).toEqual({ x: 4, y: 2, z: 0 })
  })

  it("uses two live parameters and follows a transformed face", () => {
    const { document, faceId } = createFaceDocument()
    document.parameters.u = { id: "u", value: 2 }
    document.parameters.v = { id: "v", value: 1 }
    const result = compileAction(action({
      actionId: "dynamic.create_face_point",
      inputs: { alias: "P", face: { documentId: document.metadata.id, entityId: faceId }, uv: [2, 1], parameterIds: ["u", "v"] }
    }), context(document))
    expect(result.diagnostics).toEqual([])
    const committed = applyAll(document, result.operations)
    const point = committed.primitives.find((primitive) => primitive.type === "point3" && primitive.label === "P") as Extract<typeof committed.primitives[number], { type: "point3" }>
    const primitives = new Map(committed.primitives.map((primitive) => [primitive.id, primitive]))
    expect(resolveBoundPoint3(point, primitives, committed.parameters)).toEqual({ x: 2, y: 1, z: 0 })

    committed.parameters.u!.value = 6
    committed.parameters.v!.value = 3
    expect(resolveBoundPoint3(point, primitives, committed.parameters)).toEqual({ x: 6, y: 3, z: 0 })

    const moved = commitPatch(committed, { op: "translatePrimitive3", id: faceId, delta: { x: 10, y: -2, z: 5 } })
    expect(moved.error).toBeUndefined()
    const movedPrimitives = new Map(moved.document.primitives.map((primitive) => [primitive.id, primitive]))
    const movedPoint = moved.document.primitives.find((primitive) => primitive.id === point.id) as Extract<typeof point, { type: "point3" }>
    expect(resolveBoundPoint3(movedPoint, movedPrimitives, moved.document.parameters)).toEqual({ x: 16, y: 1, z: 5 })
  })

  it.each([
    ["missing_face", "face-not-found", [1, 1]],
    ["wrong_type", "not-a-face", [1, 1]],
    ["out_of_bounds", "face", [9, 1]],
    ["non_finite", "face", [Number.NaN, 1]]
  ])("fails closed for %s", (_case, entityId, uv) => {
    const { document, faceId } = createFaceDocument()
    const wrongType = { id: "not-a-face", type: "point3", position: { x: 0, y: 0, z: 0 } } as const
    if (entityId === "not-a-face") document.primitives.push(wrongType)
    const result = compileAction(action({
      actionId: "dynamic.create_face_point",
      inputs: { alias: "P", face: { documentId: document.metadata.id, entityId: entityId === "face" ? faceId : entityId }, uv }
    }), context(document))
    expect(result.operations).toEqual([])
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it("rejects cross-document references and unknown parameter ids", () => {
    const { document, faceId } = createFaceDocument()
    const crossDocument = compileAction(action({
      actionId: "dynamic.create_face_point",
      inputs: { alias: "P", face: { documentId: "other-document", entityId: faceId }, uv: [1, 1] }
    }), context(document))
    expect(crossDocument.operations).toEqual([])
    expect(crossDocument.diagnostics[0]?.code).toBe("cross_document_reference")

    const missingParameter = compileAction(action({
      actionId: "dynamic.create_face_point",
      inputs: { alias: "P", face: { documentId: document.metadata.id, entityId: faceId }, uv: [1, 1], parameterIds: ["u", "v"] }
    }), context(document))
    expect(missingParameter.operations).toEqual([])
    expect(missingParameter.diagnostics[0]?.code).toBe("parameter_not_found")
  })
})
