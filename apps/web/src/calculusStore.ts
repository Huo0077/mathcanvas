import { create } from "zustand"

import { hasExplicitHigherMathIntent } from "@draw/agent-core"
import { routeHigherMathPrompt, type HigherMathRouteAction } from "@draw/geometry-kernel"

export interface CalculusStoreState {
  pendingRoute: HigherMathRouteAction | null
  sourcePrompt: string | null
  revision: number
  syncHigherMathRoute: (route: HigherMathRouteAction, sourcePrompt?: string) => void
  syncFromAgentPrompt: (prompt: string) => boolean
  clearSyncedRoute: () => void
}

export const useCalculusStore = create<CalculusStoreState>((set) => ({
  pendingRoute: null,
  sourcePrompt: null,
  revision: 0,
  syncHigherMathRoute: (route, sourcePrompt) =>
    set((state) => ({
      pendingRoute: route,
      sourcePrompt: sourcePrompt ?? null,
      revision: state.revision + 1
    })),
  syncFromAgentPrompt: (prompt) => {
    if (!hasExplicitHigherMathIntent(prompt)) return false
    const route = routeHigherMathPrompt(prompt)
    if (!route) return false
    set((state) => ({
      pendingRoute: route,
      sourcePrompt: prompt.trim(),
      revision: state.revision + 1
    }))
    return true
  },
  clearSyncedRoute: () =>
    set({
      pendingRoute: null,
      sourcePrompt: null
    })
}))
