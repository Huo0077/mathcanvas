import type { GeometryDocument, PrimitiveSpec, Vector3 } from "@draw/dsl"
import { commitTransaction, planeThroughPoints, type DomainOperation } from "@draw/scene-graph"

import { nextPoint3Label, nextPrimitiveId } from "./documentIds"
import type { SpatialCreationSession } from "./spatialCreationSession"

export type SpatialCommitResult = { operations: DomainOperation[]; selectedId: string } | { error: string }

/** Prepare one atomic document operation. The UI is responsible for committing it through applyBatch. */
export function commitSpatialCreation(document: GeometryDocument, session: SpatialCreationSession): SpatialCommitResult {
  if (document.workspace !== "geometry3d") return { error: "请先切换到立体几何工作区" }
  const required = session.tool === "plane3" ? 3 : session.tool === "face3" ? 3 : session.tool === "point3" ? 1 : 2
  if (session.anchors.length < required || (session.tool !== "face3" && session.anchors.length !== required)) {
    return { error: "请先完成图元所需的点" }
  }

  const added: PrimitiveSpec[] = []
  const current = (): GeometryDocument => ({ ...document, primitives: [...document.primitives, ...added] })
  const positions: Vector3[] = []
  const pointIds: string[] = []
  for (const anchor of session.anchors) {
    if (anchor.pointId) {
      const existing = document.primitives.find((primitive) => primitive.id === anchor.pointId)
      if (existing?.type !== "point3" || existing.visible === false || existing.tessellation) return { error: "选中的空间点已不可用，请重新选点" }
      pointIds.push(existing.id)
      positions.push(existing.position)
    } else {
      if (![anchor.position.x, anchor.position.y, anchor.position.z].every(Number.isFinite)) return { error: "请选择有效的空间位置" }
      const id = nextPrimitiveId(current(), "point3")
      const primitive: PrimitiveSpec = { id, type: "point3", position: anchor.position, binding: { kind: "free" }, label: nextPoint3Label(current()) }
      added.push(primitive)
      pointIds.push(id)
      positions.push(anchor.position)
    }
  }

  if (new Set(pointIds).size !== pointIds.length || positions.some((point, index) => positions.slice(0, index).some((other) => Math.hypot(point.x - other.x, point.y - other.y, point.z - other.z) < 1e-7))) {
    return { error: "请选择不同的位置" }
  }
  if ((session.tool === "plane3" || session.tool === "face3") && !planeThroughPoints(positions)) {
    return { error: "点必须不共线且位于同一平面" }
  }
  if (session.tool === "point3" && added.length === 0) return { operations: [], selectedId: pointIds[0] }

  let selectedId = pointIds[0]
  if (session.tool !== "point3") {
    selectedId = nextPrimitiveId(current(), session.tool)
    const primitive: PrimitiveSpec = session.tool === "segment3"
      ? { id: selectedId, type: "segment3", pointIds: pointIds as [string, string], label: `空间线段 ${selectedId.split("-").at(-1)}` }
      : session.tool === "line3"
        ? { id: selectedId, type: "line3", definition: { kind: "throughPoints", pointIds: pointIds as [string, string] }, label: `空间直线 ${selectedId.split("-").at(-1)}` }
        : session.tool === "ray3"
          ? { id: selectedId, type: "ray3", originId: pointIds[0], throughId: pointIds[1], label: `空间射线 ${selectedId.split("-").at(-1)}` }
          : session.tool === "plane3"
            ? { id: selectedId, type: "plane3", definition: { kind: "throughPoints", pointIds: pointIds as [string, string, string] }, label: `空间平面 ${selectedId.split("-").at(-1)}` }
            : { id: selectedId, type: "face3", pointIds, label: `空间面 ${selectedId.split("-").at(-1)}` }
    added.push(primitive)
  }
  const operations: DomainOperation[] = [{ op: "addPrimitives", primitives: added }]
  const checked = commitTransaction({ base: document, operations })
  if (!checked.changed) return { error: checked.errors.join("；") || "无法创建图元" }
  return { operations, selectedId }
}