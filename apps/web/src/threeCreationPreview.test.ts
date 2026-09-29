import { describe, expect, it } from "vitest"

import { creationPreviewVertices } from "./threeCreationPreview"

const a = { position: { x: 0, y: 0, z: 0 } }
const b = { position: { x: 2, y: 0, z: 0 } }

describe("3D drawing preview", () => {
  it("uses committed anchors and the hovered position without changing the session", () => {
    const session = { tool: "segment3" as const, anchors: [a] }
    expect(creationPreviewVertices(session, b.position)).toEqual([a.position, b.position])
    expect(session.anchors).toEqual([a])
  })

  it("closes a polygon only after at least three vertices", () => {
    expect(creationPreviewVertices({ tool: "face3", anchors: [a, b] }, null)).toEqual([a.position, b.position])
    const c = { position: { x: 0, y: 2, z: 0 } }
    expect(creationPreviewVertices({ tool: "face3", anchors: [a, b, c] }, null)).toEqual([a.position, b.position, c.position, a.position])
  })
})