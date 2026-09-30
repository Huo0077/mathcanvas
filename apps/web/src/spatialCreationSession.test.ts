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

  it("finishes a point tool after a single anchor", () => {
    expect(advanceSpatialCreation(session("point3"), A)).toEqual({
      status: "ready",
      session: { tool: "point3", anchors: [A] }
    })
  })

  it("finishes ray and line tools after two anchors", () => {
    for (const tool of ["line3", "ray3"] as const) {
      const first = advanceSpatialCreation(session(tool), A)
      expect(first.status).toBe("needs-more")
      if (first.status !== "needs-more") continue
      expect(advanceSpatialCreation(first.session, B).status).toBe("ready")
    }
  })

  it("never finishes a polygonal face on its own, however many anchors it has", () => {
    // 多边形的点数由用户决定，所以状态机不许自作主张 —— 只有 Enter 能收尾。
    let current = session("face3")
    const anchors = [A, B, C, { position: { x: 3, y: 3, z: 0 }, pointId: "D" }]
    for (const anchor of anchors) {
      const result = advanceSpatialCreation(current, anchor)
      expect(result.status).toBe("needs-more")
      current = result.session
    }
    expect(current.anchors).toHaveLength(4)
    expect(finishSpatialCreation(current)).toEqual({ status: "ready", session: current })
  })

  it("rejects a last anchor that lands on the first one, keeping the polygon open", () => {
    const first = advanceSpatialCreation(session("face3"), A)
    if (first.status !== "needs-more") throw new Error("first anchor not accepted")
    const second = advanceSpatialCreation(first.session, B)
    if (second.status !== "needs-more") throw new Error("second anchor not accepted")
    const third = advanceSpatialCreation(second.session, C)
    if (third.status !== "needs-more") throw new Error("third anchor not accepted")
    // 收尾点与首点重合：不接受，且**会话不前移**（否则多边形少一条边还悄悄多一个点）。
    expect(advanceSpatialCreation(third.session, A)).toEqual({
      status: "rejected",
      session: third.session,
      reason: "请选择不同的位置"
    })
    expect(finishSpatialCreation(third.session).status).toBe("ready")
  })

  it("rejects a non-finite position with its own reason and keeps the session clean", () => {
    const first = advanceSpatialCreation(session("segment3"), A)
    if (first.status !== "needs-more") throw new Error("first anchor not accepted")
    expect(advanceSpatialCreation(first.session, { position: { x: Number.NaN, y: 0, z: 0 } })).toEqual({
      status: "rejected",
      session: first.session,
      reason: "请选择有效的空间位置"
    })
    // 被拒之后还能正常继续：脏数据没有留在会话里。
    expect(advanceSpatialCreation(first.session, B).status).toBe("ready")
  })

  it("explains why an unfinished figure cannot be committed", () => {
    const started = advanceSpatialCreation(session("face3"), A)
    if (started.status !== "needs-more") throw new Error("first anchor not accepted")
    const tooFew = finishSpatialCreation(started.session)
    expect(tooFew.status).toBe("rejected")
    if (tooFew.status !== "rejected") return
    expect(tooFew.reason).toBe("空间面至少需要三个不同的点")

    const unfinished = finishSpatialCreation(session("segment3"))
    expect(unfinished.status).toBe("rejected")
    if (unfinished.status !== "rejected") return
    expect(unfinished.reason).toBe("请先完成图元所需的点")
  })
})