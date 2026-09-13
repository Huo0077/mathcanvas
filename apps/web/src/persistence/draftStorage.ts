import { decodeMgeo, encodeMgeo } from "@draw/dsl"
import type { GeometryDocument, Workspace } from "@draw/dsl"

const activeWorkspaceKey = "mathcanvas:active-workspace"
const draftKey = (workspace: Workspace) => `mathcanvas:draft:${workspace}`

export function saveDraft(document: GeometryDocument): void {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(draftKey(document.workspace), encodeMgeo(document))
  localStorage.setItem(activeWorkspaceKey, document.workspace)
}

export function loadDraft(workspace: Workspace): GeometryDocument | null {
  if (typeof localStorage === "undefined") return null
  const serialized = localStorage.getItem(draftKey(workspace))
  if (!serialized) return null
  try {
    return decodeMgeo(serialized)
  } catch {
    localStorage.removeItem(draftKey(workspace))
    return null
  }
}

export function loadActiveWorkspace(): Workspace | null {
  if (typeof localStorage === "undefined") return null
  const workspace = localStorage.getItem(activeWorkspaceKey)
  return workspace === "calculus" || workspace === "conics" || workspace === "cad" || workspace === "geometry3d" ? workspace : null
}
