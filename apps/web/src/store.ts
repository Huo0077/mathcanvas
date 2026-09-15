import { create } from "zustand"

import { createDefaultCadLayout, createEmptyDocument, type GeometryDocument, type Workspace } from "@draw/dsl"
import { commitPatch, type DomainOperation } from "@draw/scene-graph"

import { createDemoDocument } from "./demoDocument"
import { loadWorkbenchPreferences, saveWorkbenchPreferences, type TreeTabPreference } from "./persistence/draftStorage"

/** CAD documents always carry the default layer/sheet/view layout, even before the first save. */
export function withDocumentLayout(document: GeometryDocument): GeometryDocument {
  return document.workspace === "cad" ? createDefaultCadLayout(document) : document
}

interface SceneState {
  document: GeometryDocument
  workspaceDocuments: Partial<Record<Workspace, GeometryDocument>>
  history: GeometryDocument[]
  future: GeometryDocument[]
  previewBase: GeometryDocument | null
  error: string | null
  /** View-only workbench state: never written into `.mgeo`. */
  treeTab: TreeTabPreference
  expandedIds: string[]
  filterQuery: string
  setTreeTab: (tab: TreeTabPreference) => void
  toggleExpanded: (id: string) => void
  setExpandedIds: (ids: string[]) => void
  setFilterQuery: (query: string) => void
  apply: (operation: DomainOperation) => void
  beginPreview: () => void
  previewParameter: (id: string, value: number) => void
  commitPreview: () => void
  cancelPreview: () => void
  undo: () => void
  redo: () => void
  switchWorkspace: (workspace: Workspace) => void
  replace: (document: GeometryDocument) => void
}

export const MAX_HISTORY_ENTRIES = 100

function appendHistory(history: GeometryDocument[], document: GeometryDocument): GeometryDocument[] {
  return [...history, document].slice(-MAX_HISTORY_ENTRIES)
}

const initialDocument = createDemoDocument()
const initialPreferences = loadWorkbenchPreferences()

export const useSceneStore = create<SceneState>((set, get) => ({
  document: initialDocument,
  workspaceDocuments: { [initialDocument.workspace]: initialDocument },
  history: [],
  future: [],
  previewBase: null,
  error: null,
  treeTab: initialPreferences?.treeTab ?? "model",
  expandedIds: initialPreferences?.expandedIds ?? ["sheet-1"],
  filterQuery: "",
  setTreeTab: (tab) => {
    set({ treeTab: tab })
    saveWorkbenchPreferences({ treeTab: tab, expandedIds: get().expandedIds })
  },
  toggleExpanded: (id) => {
    const expandedIds = get().expandedIds.includes(id) ? get().expandedIds.filter((candidate) => candidate !== id) : [...get().expandedIds, id]
    set({ expandedIds })
    saveWorkbenchPreferences({ treeTab: get().treeTab, expandedIds })
  },
  setExpandedIds: (ids) => {
    set({ expandedIds: ids })
    saveWorkbenchPreferences({ treeTab: get().treeTab, expandedIds: ids })
  },
  setFilterQuery: (query) => set({ filterQuery: query }),
  apply: (operation) => set((state) => {
    const result = commitPatch(state.document, operation)
    if (!result.changed) return result.error ? { error: result.error } : state
    return {
      document: result.document,
      workspaceDocuments: { ...state.workspaceDocuments, [result.document.workspace]: result.document },
      history: appendHistory(state.history, state.document),
      future: [],
      previewBase: null,
      error: null
    }
  }),
  beginPreview: () => set((state) => state.previewBase ? state : { previewBase: state.document }),
  previewParameter: (id, value) => set((state) => {
    const result = commitPatch(state.document, { op: "setParameter", id, value })
    if (!result.changed) return result.error ? { error: result.error } : state
    return { document: result.document, workspaceDocuments: { ...state.workspaceDocuments, [result.document.workspace]: result.document }, error: null }
  }),
  commitPreview: () => set((state) => {
    if (!state.previewBase) return state
    return { history: appendHistory(state.history, state.previewBase), future: [], previewBase: null }
  }),
  cancelPreview: () => set((state) => {
    if (!state.previewBase) return state
    return { document: state.previewBase, workspaceDocuments: { ...state.workspaceDocuments, [state.previewBase.workspace]: state.previewBase }, previewBase: null, error: null }
  }),
  undo: () => set((state) => {
    const previous = state.history.at(-1)
    if (!previous) return state
    return {
      document: previous,
      workspaceDocuments: { ...state.workspaceDocuments, [previous.workspace]: previous },
      history: state.history.slice(0, -1),
      future: [state.document, ...state.future],
      previewBase: null
    }
  }),
  redo: () => set((state) => {
    const next = state.future[0]
    if (!next) return state
    return {
      document: next,
      workspaceDocuments: { ...state.workspaceDocuments, [next.workspace]: next },
      history: appendHistory(state.history, state.document),
      future: state.future.slice(1),
      previewBase: null
    }
  }),
  switchWorkspace: (workspace) => set((state) => {
    const currentDocuments = { ...state.workspaceDocuments, [state.document.workspace]: state.document }
    const nextDocument = withDocumentLayout(currentDocuments[workspace] ?? createEmptyDocument(workspace))
    return { document: nextDocument, workspaceDocuments: { ...currentDocuments, [workspace]: nextDocument }, history: [], future: [], previewBase: null, error: null }
  }),
  replace: (document) => set((state) => {
    const nextDocument = withDocumentLayout(document)
    return { document: nextDocument, workspaceDocuments: { ...state.workspaceDocuments, [nextDocument.workspace]: nextDocument }, history: [], future: [], previewBase: null, error: null }
  })
}))
