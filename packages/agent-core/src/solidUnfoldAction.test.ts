import { describe, expect, it } from "vitest"

import { actionToolSchema } from "./actionSchemas"
import { parseDraftAction } from "./schemas"

const input = {
  target: { scope: "scene", ref: { documentId: "doc-1", entityId: "solid-1" } },
  progress: 0.75
}

describe("solid.unfold agent contract", () => {
  it("publishes and parses the target reference and bounded progress", () => {
    const schema = actionToolSchema("solid.unfold" as never)
    expect(schema.inputSchema.required).toEqual(["target", "progress"])
    expect(schema.inputSchema.properties?.progress).toMatchObject({ type: "number", minimum: 0, maximum: 1 })

    const parsed = parseDraftAction({ actionId: "solid.unfold", actionKey: "unfold", factIds: [], inputs: input } as never)
    expect(parsed.ok).toBe(true)
  })
})
