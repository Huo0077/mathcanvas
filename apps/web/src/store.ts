import { create } from "zustand"

import { createDefaultCadLayout, createEmptyDocument, type GeometryDocument, type Workspace } from "@draw/dsl"
import { commitPatch, commitTransaction, type DomainOperation } from "@draw/scene-graph"

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
  /**
   * 整批提交（Task 0.4）：整批要么全部生效、要么原样返回，并且**只占一步撤销**。
   * 手工 UI 的批量删除走这里，而不是循环调用 `apply`。
   */
  applyBatch: (operations: DomainOperation[]) => void
  /**
   * **CAS 写入的唯一入口**（Task 0.7）：只有 `DocumentService` 校验通过之后才会调到这里。
   * 与 `replace` 的区别：`replace` 是"导入 / 新建文档"（清历史、换工作区文档），
   * 这里是"在现有文档上落一笔已确认的改动"（压一步历史、清 future）。
   */
  commitCandidate: (candidate: GeometryDocument) => void
  undo: () => void
  redo: () => void
  switchWorkspace: (workspace: Workspace) => void
  replace: (document: GeometryDocument) => void
}

export const MAX_HISTORY_ENTRIES = 100

function appendHistory(history: GeometryDocument[], document: GeometryDocument): GeometryDocument[] {
  return [...history, document].slice(-MAX_HISTORY_ENTRIES)
}

/** Start new sessions in the planar workspace while keeping other workspaces available on demand. */
const initialDocument = withDocumentLayout(createEmptyDocument("conics"))
const initialPreferences = loadWorkbenchPreferences()

export const useSceneStore = create<SceneState>((set, get) => ({
  document: initialDocument,
  workspaceDocuments: { [initialDocument.workspace]: initialDocument },
  history: [],
  future: [],
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
      error: null
    }
  }),
  applyBatch: (operations) => set((state) => {
    if (operations.length === 0) return state
    const result = commitTransaction({ base: state.document, operations })
    if (!result.changed) return result.errors.length > 0 ? { error: result.errors.join(", ") } : state
    return {
      document: result.document,
      workspaceDocuments: { ...state.workspaceDocuments, [result.document.workspace]: result.document },
      // 整批只压一步：撤销一次就回到批量操作之前。
      history: appendHistory(state.history, state.document),
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
      history: appendHistory(state.history, state.document),
      future: state.future.slice(1)
    }
  }),
  switchWorkspace: (workspace) => set((state) => {
    const currentDocuments = { ...state.workspaceDocuments, [state.document.workspace]: state.document }
    const nextDocument = withDocumentLayout(currentDocuments[workspace] ?? createEmptyDocument(workspace))
    return { document: nextDocument, workspaceDocuments: { ...currentDocuments, [workspace]: nextDocument }, history: [], future: [], error: null }
  }),
  commitCandidate: (candidate) => set((state) => {
    const nextDocument = withDocumentLayout(candidate)
    /** 内容没变就不留历史：与 `apply` / `applyBatch` 同一口径（no-op 不占撤销栈）。 */
    if (nextDocument.revision === state.document.revision && nextDocument.metadata.id === state.document.metadata.id) {
      return state
    }
    return {
      document: nextDocument,
      workspaceDocuments: { ...state.workspaceDocuments, [nextDocument.workspace]: nextDocument },
      history: appendHistory(state.history, state.document),
      future: [],
      error: null
    }
  }),
  replace: (document) => set((state) => {
    const nextDocument = withDocumentLayout(document)
    return { document: nextDocument, workspaceDocuments: { ...state.workspaceDocuments, [nextDocument.workspace]: nextDocument }, history: [], future: [], error: null }
  })
}))
