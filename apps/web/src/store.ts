import { create } from "zustand"

import { createDefaultCadLayout, createEmptyDocument, type GeometryDocument, type Workspace } from "@draw/dsl"
import { commitPatch, commitTransaction, contentFingerprint, type DomainOperation } from "@draw/scene-graph"

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
  /**
   * **这一次文档变化是谁引起的**（对话切片 Fix round 1 / C1）。
   *
   * `"user"`：用户自己换了工作区 / 打开文件 —— Agent 区的会话列表该跟着换（规格 §5.1）。
   * `"agent"`：Agent 为了执行这条计划自己切的工作区（"建一个立方体"要切到立体几何）——
   * 那不是用户换了上下文，**不能**把用户正在读的那条会话与它的确认面板换走。
   * 少了这一项，App 那一层只能看到"文档变了"，于是两条完全不同的意图被当成一件事。
   */
  documentChangeReason: DocumentChangeReason
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
  switchWorkspace: (workspace: Workspace, reason?: DocumentChangeReason) => void
  replace: (document: GeometryDocument) => void
}

/** 文档变化的来源（见 `SceneState.documentChangeReason`）。 */
export type DocumentChangeReason = "user" | "agent"

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
  documentChangeReason: "user",
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
  switchWorkspace: (workspace, reason = "user") => set((state) => {
    const currentDocuments = { ...state.workspaceDocuments, [state.document.workspace]: state.document }
    const nextDocument = withDocumentLayout(currentDocuments[workspace] ?? createEmptyDocument(workspace))
    return { document: nextDocument, workspaceDocuments: { ...currentDocuments, [workspace]: nextDocument }, history: [], future: [], error: null, documentChangeReason: reason }
  }),
  commitCandidate: (candidate) => set((state) => {
    const nextDocument = withDocumentLayout(candidate)
    /**
     * **"没变"的判据是内容，不是 `revision`**（2026-09-21 修的真实缺陷）。
     *
     * 这份候选来自 Agent 那条链路（`HostBridge` → `commitTransaction`），而
     * `commitTransaction` **不推进 `revision`** —— 推进它的是这里的 `apply` / `applyBatch`。
     * 原先用"`revision` 与 `metadata.id` 都相同"判"内容没变"，于是一次**真的改了内容**的提交
     * 被静默丢掉：确认面板说"已提交"，画布上什么都没有；而自动保存把那份没变的空文档写回
     * 本地草稿（实测草稿里是 `revision: 0` + `primitives: []`）。
     */
    if (contentFingerprint(nextDocument) === contentFingerprint(state.document)) return state
    /**
     * 内容变了就**必须记一次**。候选带来的 `revision` 若没有超过当前值（Agent 那条路就是这样，
     * 它带的是基准那一版），就由这里推进 —— 否则撤销栈、仓储的 generation 与 CAS 全都停在原地。
     */
    const advanced = nextDocument.revision > state.document.revision ? nextDocument : { ...nextDocument, revision: state.document.revision + 1 }
    return {
      document: advanced,
      workspaceDocuments: { ...state.workspaceDocuments, [advanced.workspace]: advanced },
      history: appendHistory(state.history, state.document),
      future: [],
      error: null
    }
  }),
  replace: (document) => set((state) => {
    const nextDocument = withDocumentLayout(document)
    // 打开文件 / 导入 / 恢复草稿都是**用户**这一侧的上下文变化（不是 Agent 自己切的）。
    return { document: nextDocument, workspaceDocuments: { ...state.workspaceDocuments, [nextDocument.workspace]: nextDocument }, history: [], future: [], error: null, documentChangeReason: "user" }
  })
}))
