import type { GeometryDocument } from "@draw/dsl"
import type { DragSessionState, ThreeSceneEffectDeps } from "./threeSceneEffect"
import { dragPreviewDocument } from "./threeDragPreview"

export interface ThreeSceneDragVisualsDeps {
  documentRef: ThreeSceneEffectDeps["documentRef"]
  dragSessionRef: ThreeSceneEffectDeps["dragSessionRef"]
  syncContent: (document?: GeometryDocument, preview?: boolean) => void
  render: () => void
}

/** All spatial drag modes share the normal dependency evaluator and incremental
 * renderer. The preview never replaces documentRef or writes an undo entry.
 */
export function createThreeSceneDragVisuals({ documentRef, dragSessionRef, syncContent, render }: ThreeSceneDragVisualsDeps) {
  const previewDrag = (session: DragSessionState) => {
    let preview: GeometryDocument
    try { preview = dragPreviewDocument(documentRef.current, session) }
    catch { return false } // Invalid candidate (e.g. overlapping solid vertices): keep the last valid frame.
    syncContent(preview, true)
    return true
  }
  // Restore the canonical content records before the release callback. Do not
  // paint the old document between the last preview and the committed frame.
  const clearDragPreview = () => { syncContent(documentRef.current, true) }
  const resumeDragVisual = () => {
    const session = dragSessionRef.current
    if (!session?.applied) return
    previewDrag(session)
    render()
  }
  return { previewDrag, clearDragPreview, resumeDragVisual }
}
