import { create } from "zustand"

import type { GeometryDocument } from "@draw/dsl"
import { commitPatch, type DomainOperation } from "@draw/scene-graph"

import { createDemoDocument } from "./demoDocument"

interface SceneState {
  document: GeometryDocument
  history: GeometryDocument[]
  future: GeometryDocument[]
  apply: (operation: DomainOperation) => void
  undo: () => void
  redo: () => void
  replace: (document: GeometryDocument) => void
}

export const useSceneStore = create<SceneState>((set) => ({
  document: createDemoDocument(),
  history: [],
  future: [],
  apply: (operation) => set((state) => {
    const result = commitPatch(state.document, operation)
    if (!result.changed) return state
    return { document: result.document, history: [...state.history, state.document], future: [] }
  }),
  undo: () => set((state) => {
    const previous = state.history.at(-1)
    if (!previous) return state
    return { document: previous, history: state.history.slice(0, -1), future: [state.document, ...state.future] }
  }),
  redo: () => set((state) => {
    const next = state.future[0]
    if (!next) return state
    return { document: next, history: [...state.history, state.document], future: state.future.slice(1) }
  }),
  replace: (document) => set({ document, history: [], future: [] })
}))
