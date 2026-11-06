import type { PlanEnvelope } from "./contracts"
import { deterministicPlanForPrompt } from "./parametricSolidPlan"
import { rightPrismMidpointsPlan } from "./rightPrismPlan"
import { tryBuildScopedPyramidPlan } from "./scopedPyramidPlan"
import { tryBuildTrigMonotonicityPlan } from "./trigMonotonicityPlan"

export interface DeterministicProblemRoute {
  plan: PlanEnvelope
  family: "functions" | "spatial-modeling"
  diagramPrompt?: string
}

export function routeDeterministicProblem(prompt: string): DeterministicProblemRoute | null {
  const prism = rightPrismMidpointsPlan(prompt)
  if (prism) return { plan: prism, family: "spatial-modeling" }
  const trig = tryBuildTrigMonotonicityPlan(prompt)
  if (trig) return { plan: trig, family: "functions" }
  const pyramid = tryBuildScopedPyramidPlan(prompt)
  if (pyramid) return { ...pyramid, family: "spatial-modeling" }
  const solid = deterministicPlanForPrompt(prompt)
  return solid ? { plan: solid, family: "spatial-modeling" } : null
}
