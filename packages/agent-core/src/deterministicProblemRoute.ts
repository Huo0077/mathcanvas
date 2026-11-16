import type { PlanEnvelope } from "./contracts"
import { compileConstructionDag, deriveRequiredDrawingIntent, type CompiledDrawingDagResult } from "./drawingIntent"
import { deterministicPlanForPrompt } from "./parametricSolidPlan"
import { tryBuildPlanarDrawingPlan } from "./solver/planarDrawing"
import { tryBuildRightPrismMidpointsPlan } from "./rightPrismPlan"
import { tryBuildScopedPyramidPlan } from "./scopedPyramidPlan"
import { tryBuildTrigMonotonicityPlan } from "./trigMonotonicityPlan"

export interface DeterministicProblemRoute {
  plan: PlanEnvelope
  family: "functions" | "spatial-modeling" | "conics-tangents" | "planar-basics"
  skillIds?: readonly string[]
  diagramPrompt?: string
}

export function routeDeterministicProblemWithIntent(prompt: string): (DeterministicProblemRoute & { intentDag: CompiledDrawingDagResult }) | null {
  const routed = routeDeterministicProblem(prompt)
  if (routed === null) return null
  const intent = deriveRequiredDrawingIntent({ prompt: routed.diagramPrompt ?? prompt })
  return { ...routed, intentDag: compileConstructionDag(intent.nodes) }
}

export function routeDeterministicProblem(prompt: string): DeterministicProblemRoute | null {
  const prism = tryBuildRightPrismMidpointsPlan(prompt)
  if (prism) return { ...prism, family: "spatial-modeling" }
  const trig = tryBuildTrigMonotonicityPlan(prompt)
  if (trig) return { plan: trig, family: "functions" }
  const pyramid = tryBuildScopedPyramidPlan(prompt)
  if (pyramid) return { ...pyramid, family: "spatial-modeling" }
  const planar = tryBuildPlanarDrawingPlan(prompt)
  if (planar && planar.plan.kind === "plan") return { plan: planar.plan, family: planar.family, skillIds: planar.skillIds, diagramPrompt: planar.diagramPrompt }
  const solid = deterministicPlanForPrompt(prompt)
  return solid ? { plan: solid, family: "spatial-modeling" } : null
}
