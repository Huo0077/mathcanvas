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
    const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant")
    if (!latestAssistant || latestAssistant.pending || latestAssistant.commit || latestAssistant.failure || !latestAssistant.draft) {
      return undefined
    }
    return latestAssistant
  })

  return useMemo(() => {
    if (!activeDraftMessage?.draft) return null
    const staged = agentRunner.getActiveDraftCandidate(activeDraftMessage.runId)
    if (!staged) return null
    const existingById = new Map(document.primitives.map((p) => [p.id, p]))
    // 清除重建后新草稿可能复用与旧文档相同的 id（solid-1/point-1…），需对比内容而非仅看 id 差集
    const changedOrNew = staged.candidate.primitives.filter((p) => {
      const prev = existingById.get(p.id)
      return !prev || JSON.stringify(prev) !== JSON.stringify(p)
    })
    const primitiveCount = changedOrNew.length > 0 ? changedOrNew.length : staged.candidate.primitives.length
    return {
      candidate: staged.candidate,
      runId: staged.runId,
      draftId: staged.draftId,
      primitiveCount,
      newPrimitives: changedOrNew
    }
  }, [activeDraftMessage?.draft, activeDraftMessage?.runId, document])
}
