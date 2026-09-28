import { describe, expect, it } from "vitest"

import { ACTIONS, SOLID_TEMPLATES } from "./actionRegistry"
import { allActionToolSchemas, actionToolSchema, parseActionToolInput } from "./actionSchemas"

describe("action tool schemas", () => {
  it("generates one strict schema for every registered action", () => {
    const schemas = allActionToolSchemas()

    expect(schemas).toHaveLength(Object.keys(ACTIONS).length)
    expect(new Set(schemas.map((schema) => schema.actionId)).size).toBe(schemas.length)
    for (const schema of schemas) {
      expect(schema.inputSchema.type).toBe("object")
      expect(schema.inputSchema.additionalProperties).toBe(false)
    }
  })

  it("publishes enum and required metadata from the action registry", () => {
    const schema = actionToolSchema("solid.create_template")

    expect(schema.inputSchema.required).toEqual(expect.arrayContaining(["alias", "template"]))
    expect(schema.inputSchema.properties?.template?.enum).toEqual(SOLID_TEMPLATES)
  })

  it("models list references as arrays of strings", () => {
    const schema = actionToolSchema("object.delete_many")

    expect(schema.inputSchema.properties?.targets).toMatchObject({ type: "array", items: { type: "string" } })
  })
})

describe("published schemas match the existing action parser", () => {
  it("does not demand fields that parameter audit can safely complete", () => {
    expect(actionToolSchema("solid.create_template").inputSchema.required).toEqual(["alias", "template"])
    expect(actionToolSchema("solid.create_prism").inputSchema.required).toEqual(["alias"])
    expect(actionToolSchema("solid.create_tetrahedron").inputSchema.required).toEqual(["alias"])
  })

  it("uses planar coordinates for planar actions and three coordinates for spatial ones", () => {
    const planar = actionToolSchema("planar.create_circle").inputSchema.properties?.center
    const spatial = actionToolSchema("solid.create_template").inputSchema.properties?.origin
    const size = actionToolSchema("solid.create_template").inputSchema.properties?.size
    expect(planar?.required).toEqual(["x", "y"])
    expect(planar?.properties?.z).toBeUndefined()
    expect(spatial?.required).toEqual(["x", "y", "z"])
    expect(size?.required).toEqual(["x", "y", "z"])
  })

  it("represents the tangent anchor variants rather than a scoped object reference", () => {
    const anchor = actionToolSchema("function.create_tangent").inputSchema.properties?.anchor
    expect(anchor?.oneOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ properties: expect.objectContaining({ kind: expect.objectContaining({ enum: ["point"] }), pointId: expect.objectContaining({ type: "string" }) }) }),
      expect.objectContaining({ properties: expect.objectContaining({ kind: expect.objectContaining({ enum: ["parameter"] }), parameter: expect.objectContaining({ type: "number" }) }) })
    ]))
  })

  it("closes the update patch over the same editable fields as the scene graph", () => {
    const patch = actionToolSchema("object.update_inputs").inputSchema.properties?.patch
    expect(patch?.additionalProperties).toBe(false)
    expect(patch?.properties?.x?.type).toBe("number")
    expect(patch?.properties?.label?.type).toBe("string")
    expect(patch?.properties?.visible?.type).toBe("boolean")
    expect(patch?.properties?.notEditable).toBeUndefined()
  })


  it("publishes every supported three-point and point-normal section plane input", () => {
    const plane = actionToolSchema("section.create").inputSchema.properties?.plane
    const variants = plane?.oneOf ?? []
    expect(variants).toHaveLength(5)
    expect(variants.find((variant) => variant.properties?.points)).toMatchObject({ required: ["points"], properties: { points: { minItems: 3, maxItems: 3 } } })
    expect(variants.find((variant) => variant.properties?.throughPoints)).toMatchObject({ required: ["throughPoints"], properties: { throughPoints: { minItems: 3, maxItems: 3 } } })
    expect(variants.find((variant) => variant.properties?.origin)).toMatchObject({ required: ["origin", "normal"] })
  })

  it("uses scoped references only for fields registered as scoped", () => {
    const scoped = actionToolSchema("dynamic.bind_point").inputSchema.properties?.target
    const bareId = actionToolSchema("section.create").inputSchema.properties?.sourceId
    expect(scoped?.oneOf).toHaveLength(2)
    expect(bareId?.type).toBe("string")
  })
})

describe("tool inputs reuse the actual plan parser", () => {
  it("accepts a valid create action and gives it the coordinator action key", () => {
    const result = parseActionToolInput("solid.create_template", { alias: "cube", template: "cube", size: { x: 3, y: 3, z: 3 } }, "step-1")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toMatchObject({ actionId: "solid.create_template", actionKey: "step-1", inputs: { alias: "cube", size: { x: 3, y: 3, z: 3 } } })
  })

  it("rejects undeclared input fields at the model tool boundary", () => {
    const result = parseActionToolInput("solid.create_prism", { alias: "p", faces: [] }, "step-2")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unknown_field", path: "tool.inputs.faces" })]))
  })

  it("rejects an unscoped object reference before staging a draft", () => {
    const result = parseActionToolInput("object.update_inputs", { target: { entityId: "cube-1" }, patch: { x: 2 } }, "step-3")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unscoped_reference", path: "tool.inputs.target" })]))
  })
})
