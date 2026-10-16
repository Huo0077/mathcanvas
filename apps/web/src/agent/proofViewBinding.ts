import { canonicalContentHash } from "@draw/agent-core"
import type { GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import type { AgentCommitView, AgentDraftView } from "../agentStore"

/** A read-time projection: retain the historical backend verdict, but never present it as current on another scene. */
export function proofDraftForScene(draft: AgentDraftView, commit: AgentCommitView | undefined, document: GeometryDocument): AgentDraftView {
  if (!draft.proofAttempt || draft.proofAttempt.outcome === "stale") return draft
  const binding = draft.proofSceneBinding
  const expected = commit?.status === "committed" || commit?.status === "no_change" ? binding?.candidateContentHash : binding?.baseContentHash
  if (binding?.documentId === document.metadata.id && expected === canonicalContentHash(JSON.parse(contentFingerprint(document)))) return draft
  const detail = binding
    ? "当前画布已被撤销、修改或替换；这次历史证明结果不再对应当前画布。请基于当前题面和图形重新运行。"
    : "这次历史证明没有保存图形绑定，无法确认它对应当前画布；请重新运行。"
  return { ...draft, proofAttempt: { ...draft.proofAttempt, outcome: "stale", stale: { kind: binding ? "scene_changed" : "scene_binding_unavailable", detail } } }
}
