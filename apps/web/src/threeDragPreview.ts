import { validateDocument, type GeometryDocument } from "@draw/dsl"
import { applyOperation, type DomainOperation } from "@draw/scene-graph"
import type { DragSessionState } from "./threeSceneEffect"
import { hostPointDragOperations } from "./hostPointDrag"
import { planConstrainedDrag3 } from "./constrainedDrag3"
import { agentNextPhaseFlags } from "./agent/featureFlags"
import { rotationDragDegrees } from "./threeDrag"

/** Evaluate a visual-only snapshot from the canonical document and cumulative drag.
 * Never feed the previous preview back in: both constraints and transforms must
 * have exactly the same semantics as the single operation committed on release.
 */
export function dragPreviewDocument(base: GeometryDocument, session: DragSessionState, constrainedDrag = agentNextPhaseFlags().constrainedDrag): GeometryDocument {
  let operations: DomainOperation[]
  if (session.scale) {
    operations = [{ op: "updatePrimitive", id: session.targetId, patch: { radius3: session.scale.current } }]
  } else if (session.rotation) {
    operations = [{ op: "rotatePrimitive3", id: session.targetId, axis: session.rotation.state.axis, degrees: rotationDragDegrees(session.rotation.state) }]
  } else if (session.hostConstraint && session.hostParameter) {
    operations = hostPointDragOperations(base, session.targetId, session.hostParameter)
  } else if (session.slideNormal) {
    operations = [{ op: "moveSectionPlane", id: session.targetId, distance: session.total.dot(session.slideNormal) }]
  } else {
    const delta = { x: session.total.x, y: session.total.y, z: session.total.z }
    const outcome = planConstrainedDrag3({ document: base, draggedId: session.targetId, delta, enabled: constrainedDrag })
    operations = outcome.kind === "commit" ? outcome.operations
      : outcome.kind === "passthrough" ? [{ op: "translatePrimitive3", id: session.targetId, delta }] : []
  }
  let preview = base
  for (const operation of operations) {
    const result = applyOperation(preview, operation)
    if (result.error) throw new Error(`Drag preview failed: ${result.error}`)
    preview = result.document
  }
  // Release validates the complete transaction, not just each operation.
  // Reject the same invalid candidates here rather than showing uncommittable geometry.
  if (preview !== base) {
    const validation = validateDocument(preview)
    if (!validation.valid) throw new Error(`Drag preview failed: ${validation.errors.join("; ")}`)
  }
  return preview
}
