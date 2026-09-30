import type { Vector3 } from "@draw/dsl"

export type SpatialTool = "point3" | "segment3" | "line3" | "ray3" | "plane3" | "face3"

export interface SpatialAnchor {
  position: Vector3
  pointId?: string
}

export interface SpatialCreationSession {
  tool: SpatialTool
  anchors: SpatialAnchor[]
}

export type SpatialCreationResult =
  | { status: "needs-more" | "ready"; session: SpatialCreationSession }
  | { status: "rejected"; session: SpatialCreationSession; reason: string }

const requiredAnchors: Record<Exclude<SpatialTool, "face3">, number> = {
  point3: 1,
  segment3: 2,
  line3: 2,
  ray3: 2,
  plane3: 3
}

export function advanceSpatialCreation(session: SpatialCreationSession, anchor: SpatialAnchor): SpatialCreationResult {
  if (!Object.values(anchor.position).every(Number.isFinite)) {
    return { status: "rejected", session, reason: "请选择有效的空间位置" }
  }
  if (session.anchors.some((previous) => Math.hypot(
    previous.position.x - anchor.position.x,
    previous.position.y - anchor.position.y,
    previous.position.z - anchor.position.z
  ) < 1e-7)) return { status: "rejected", session, reason: "请选择不同的位置" }
  const next = { ...session, anchors: [...session.anchors, anchor] }
  return { status: session.tool !== "face3" && next.anchors.length >= requiredAnchors[session.tool] ? "ready" : "needs-more", session: next }
}

export function finishSpatialCreation(session: SpatialCreationSession): SpatialCreationResult {
  if (session.tool === "face3" && session.anchors.length >= 3) return { status: "ready", session }
  return { status: "rejected", session, reason: session.tool === "face3" ? "空间面至少需要三个不同的点" : "请先完成图元所需的点" }
}

export function removeLastSpatialAnchor(session: SpatialCreationSession): SpatialCreationSession {
  return { ...session, anchors: session.anchors.slice(0, -1) }
}