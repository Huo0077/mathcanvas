import { describe, expect, it } from "vitest"

import { advanceSpatialCreation, finishSpatialCreation, removeLastSpatialAnchor, type SpatialCreationSession } from "./spatialCreationSession"

const A = { position: { x: 0, y: 0, z: 0 }, pointId: "A" }
const B = { position: { x: 2, y: 0, z: 0 }, pointId: "B" }
const C = { position: { x: 0, y: 3, z: 0 }, pointId: "C" }

function session(tool: SpatialCreationSession["tool"]): SpatialCreationSession {
  return { tool, anchors: [] }
}

describe("spatial creation session", () => {
  it("finishes a segment after exactly two distinct anchors", () => {
    const first = advanceSpatialCreation(session("segment3"), A)
    expect(first.status).toBe("needs-more")
    if (first.status !== "needs-more") return
    const second = advanceSpatialCreation(first.session, B)
    expect(second).toEqual({ status: "ready", session: { tool: "segment3", anchors: [A, B] } })
  })

  it("rejects a second anchor on top of the first without losing progress", () => {
    const first = advanceSpatialCreation(session("line3"), A)
    if (first.status !== "needs-more") throw new Error("first anchor not accepted")
    expect(advanceSpatialCreation(first.session, { position: { x: 0, y: 0, z: 0 } })).toEqual({ status: "rejected", session: first.session, reason: "请选择不同的位置" })
  })

  it("finishes a plane after three distinct anchors", () => {
    const first = advanceSpatialCreation(session("plane3"), A)
    if (first.status !== "needs-more") throw new Error("first anchor not accepted")
    const second = advanceSpatialCreation(first.session, B)
    if (second.status !== "needs-more") throw new Error("second anchor not accepted")
    expect(advanceSpatialCreation(second.session, C).status).toBe("ready")
  })

  it("requires three vertices and Enter to finish a polygonal face", () => {
    const first = advanceSpatialCreation(session("face3"), A)
    if (first.status !== "needs-more") throw new Error("first anchor not accepted")
    const second = advanceSpatialCreation(first.session, B)
    if (second.status !== "needs-more") throw new Error("second anchor not accepted")
    expect(finishSpatialCreation(second.session).status).toBe("rejected")
    const third = advanceSpatialCreation(second.session, C)
    expect(third.status).toBe("needs-more")
    if (third.status !== "needs-more") return
    expect(finishSpatialCreation(third.session)).toEqual({ status: "ready", session: third.session })
    expect(removeLastSpatialAnchor(third.session).anchors).toEqual([A, B])
  })
})