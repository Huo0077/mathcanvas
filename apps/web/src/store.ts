import { create } from "zustand"

import { createEmptyDocument, type GeometryDocument, type Workspace } from "@draw/dsl"
import { commitPatch, type DomainOperation } from "@draw/scene-graph"

import { createDemoDocument } from "./demoDocument"

interface SceneState {
  document: GeometryDocument
  workspaceDocuments: Partial<Record<Workspace, GeometryDocument>>
  history: GeometryDocument[]
  future: GeometryDocument[]
  error: string | null
  apply: (operation: DomainOperation) => void
  undo: () => void
  redo: () => void
  switchWorkspace: (workspace: Workspace) => void
  replace: (document: GeometryDocument) => void
}

const initialDocument = createDemoDocument()

export const useSceneStore = create<SceneState>((set) => ({
  document: initialDocument,
  workspaceDocuments: { [initialDocument.workspace]: initialDocument },
  history: [],
  future: [],
  error: null,
  apply: (operation) => set((state) => {
    const result = commitPatch(state.document, operation)
    if (!result.changed) return result.error ? { error: result.error } : state
    return {
      document: result.document,
      workspaceDocuments: { ...state.workspaceDocuments, [result.document.workspace]: result.document },
      history: [...state.history, state.document],
      future: [],
      error: null
    }
  }),
  undo: () => set((state) => {
    const previous = state.history.at(-1)
    if (!previous) return state
    return {
      document: previous,
      workspaceDocuments: { ...state.workspaceDocuments, [previous.workspace]: previous },
      history: state.history.slice(0, -1),
      future: [state.document, ...state.future]
    }
  }),
  redo: () => set((state) => {
    const next = state.future[0]
    if (!next) return state
    return {
      document: next,
      workspaceDocuments: { ...state.workspaceDocuments, [next.workspace]: next },
      history: [...state.history, state.document],
      future: state.future.slice(1)
    }
  }),
  switchWorkspace: (workspace) => set((state) => {
    const currentDocuments = { ...state.workspaceDocuments, [state.document.workspace]: state.document }
    const nextDocument = currentDocuments[workspace] ?? createEmptyDocument(workspace)
    return { document: nextDocument, workspaceDocuments: { ...currentDocuments, [workspace]: nextDocument }, history: [], future: [], error: null }
  }),
  replace: (document) => set((state) => ({ document, workspaceDocuments: { ...state.workspaceDocuments, [document.workspace]: document }, history: [], future: [], error: null }))
}))
