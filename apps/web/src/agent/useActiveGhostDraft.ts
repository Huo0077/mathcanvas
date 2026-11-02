import { useMemo } from "react"
import type { GeometryDocument } from "@draw/dsl"
import { useAgentStore } from "../agentStore"
import { agentRunner } from "./agentRunner"

export interface ActiveGhostDraft {
  candidate: GeometryDocument
  runId: string
  draftId: string
  primitiveCount: number
  newPrimitives: GeometryDocument["primitives"]
}

export function useActiveGhostDraft(document: GeometryDocument): ActiveGhostDraft | null {
  const activeDraftMessage = useAgentStore((state) => {
    const messages = state.activeConversation?.messages ?? []
    return [...messages].reverse().find((m) => m.draft && !m.commit && !m.failure)
  })

  return useMemo(() => {
    if (!activeDraftMessage?.draft) return null
    const staged = agentRunner.getActiveDraftCandidate(activeDraftMessage.runId)
    if (!staged) return null
    const existingIds = new Set(document.primitives.map((p) => p.id))
    const newPrimitives = staged.candidate.primitives.filter((p) => !existingIds.has(p.id))
    return {
      candidate: staged.candidate,
      runId: staged.runId,
      draftId: staged.draftId,
      primitiveCount: newPrimitives.length,
      newPrimitives
    }
  }, [activeDraftMessage?.draft, activeDraftMessage?.runId, document])
}
