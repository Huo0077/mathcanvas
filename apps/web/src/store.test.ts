import { describe, expect, it } from "vitest"

import { createDemoDocument } from "./demoDocument"
import { MAX_HISTORY_ENTRIES, useSceneStore } from "./store"

describe("scene store document replacement", () => {
  it("keeps documents cached for other workspaces so switching back preserves in-session work", () => {
    useSceneStore.getState().replace(createDemoDocument())
    useSceneStore.getState().switchWorkspace("geometry3d")
    useSceneStore.getState().apply({
      op: "addPrimitive",
      primitive: { id: "point3-a", type: "point3", position: { x: 1, y: 2, z: 3 }, binding: { kind: "free" } }
    })
    useSceneStore.getState().switchWorkspace("calculus")

    useSceneStore.getState().replace({ ...createDemoDocument(), metadata: { ...createDemoDocument().metadata, name: "opened" } })

    expect(useSceneStore.getState().document.workspace).toBe("calculus")
    expect(useSceneStore.getState().workspaceDocuments.geometry3d?.primitives).toHaveLength(1)
    expect(useSceneStore.getState().workspaceDocuments.calculus?.metadata.name).toBe("opened")
  })

  it("caps undo history while retaining the newest document snapshots", () => {
    useSceneStore.getState().replace(createDemoDocument())

    for (let index = 0; index < MAX_HISTORY_ENTRIES + 1; index += 1) {
      useSceneStore.getState().apply({ op: "setParameter", id: "slope", value: 0.15 + (index % 15) * 0.05 })
    }

    expect(useSceneStore.getState().history).toHaveLength(MAX_HISTORY_ENTRIES)
    expect(useSceneStore.getState().document.parameters.slope?.value).toBeCloseTo(0.65)

    for (let index = 0; index < MAX_HISTORY_ENTRIES; index += 1) useSceneStore.getState().undo()

    expect(useSceneStore.getState().history).toHaveLength(0)
    expect(useSceneStore.getState().document.parameters.slope?.value).toBeCloseTo(0.15)
  })
})
