import { describe, expect, it } from "vitest"

import { actionToolSchema } from "./actionSchemas"
import { parseDraftAction } from "./schemas"

const valid = (inputs: Record<string, unknown> = {}) => parseDraftAction({
  actionId: "dynamic.create_face_point",
  actionKey: "face-point",
  factIds: [],
  inputs: {
    alias: "P",
    face: { scope: "scene", ref: { documentId: "doc-1", entityId: "face-1" } },
    uv: [0.25, 0.5],
    ...inputs
  }
})

describe("dynamic.create_face_point agent input boundary", () => {
  it("parses a scoped face, exact uv pair, and optional parameter pair", () => {
    const result = valid({ parameterIds: ["u", "v"], label: "P" })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.inputs).toEqual({
        alias: "P",
        face: { documentId: "doc-1", entityId: "face-1" },
        uv: [0.25, 0.5],
        parameterIds: ["u", "v"],
        label: "P"
      })
    }
  })

  it.each([
    ["missing face", { face: undefined }],
    ["wrong uv length", { uv: [0.25] }],
    ["non-finite uv", { uv: [Number.NaN, 0.5] }],
    ["wrong parameter length", { parameterIds: ["u"] }],
    ["non-string parameter id", { parameterIds: ["u", 2] }],
    ["wrong face shape", { face: { entityId: "face-1" } }]
  ])("rejects %s", (_name, overrides) => {
    const result = valid(overrides)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
  })

  it("publishes the same exact pair contract", () => {
    const schema = actionToolSchema("dynamic.create_face_point").inputSchema
    expect(schema.properties?.uv).toMatchObject({ type: "array", minItems: 2, maxItems: 2 })
    expect(schema.properties?.parameterIds).toMatchObject({ type: "array", minItems: 2, maxItems: 2 })
    expect(schema.required).toEqual(expect.arrayContaining(["alias", "face", "uv"]))
  })
})
