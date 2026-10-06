export type DiagramIntent = "required" | "helpful" | "none" | "unknown"
export type DiagramFamily = "triangle" | "conic" | "derivative_graph" | "solid3d"
export interface DiagramScopeDecision {
  subtypeId: string
  defaultIntent: DiagramIntent
  family?: DiagramFamily
  reviewBasis: string
}
export interface DiagramScopeAudit {
  requiredSubtypes: string[]
  visualCandidateSubtypes: string[]
  nonDiagramDefaults: string[]
  unknownSubtypes: string[]
  duplicateIds: string[]
  outOfScope: string[]
  ready: boolean
}
/**
 * A reviewed scope row cannot shrink the official source list. This is a source
 * audit, not a natural-language classifier or a claim of successful drawing.
 */
export function auditDiagramScope(source: ReadonlySet<string>, decisions: readonly DiagramScopeDecision[]): DiagramScopeAudit {
  const requiredSubtypes: string[] = []
  const visualCandidateSubtypes: string[] = []
  const nonDiagramDefaults: string[] = []
  const unknownSubtypes: string[] = []
  const duplicateIds: string[] = []
  const outOfScope: string[] = []
  const reviewed = new Set<string>()
  for (const decision of decisions) {
    if (reviewed.has(decision.subtypeId)) duplicateIds.push(decision.subtypeId)
    reviewed.add(decision.subtypeId)
    if (!source.has(decision.subtypeId) || !decision.reviewBasis.trim()
      || ((decision.defaultIntent === "required" || decision.defaultIntent === "helpful") && decision.family === undefined)) {
      outOfScope.push(decision.subtypeId)
      continue
    }
    if (decision.defaultIntent === "required") requiredSubtypes.push(decision.subtypeId)
    if (decision.defaultIntent === "required" || decision.defaultIntent === "helpful") visualCandidateSubtypes.push(decision.subtypeId)
    if (decision.defaultIntent === "none") nonDiagramDefaults.push(decision.subtypeId)
    if (decision.defaultIntent === "unknown") unknownSubtypes.push(decision.subtypeId)
  }
  for (const id of source) {
    if (!reviewed.has(id)) unknownSubtypes.push(id)
  }
  return {
    requiredSubtypes, visualCandidateSubtypes, nonDiagramDefaults, unknownSubtypes, duplicateIds, outOfScope,
    ready: source.size > 0 && visualCandidateSubtypes.length > 0 && unknownSubtypes.length === 0 && duplicateIds.length === 0 && outOfScope.length === 0
  }
}

/** An explicit request for a diagram may override a normally nonvisual topic. */
export function resolveDiagramIntent(defaultIntent: DiagramIntent, explicitDrawRequest: boolean): DiagramIntent {
  return explicitDrawRequest ? "required" : defaultIntent
}
