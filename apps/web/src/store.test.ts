import { describe, expect, it } from "vitest"

import { createDemoDocument } from "./demoDocument"
import { useSceneStore } from "./store"

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
})
