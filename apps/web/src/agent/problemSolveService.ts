import { routeDeterministicProblem, SKILL_MANIFESTS, type HashText, type SolveContext, type MathFact, type PlannerPort } from "@draw/agent-core"
import { createAgentRuntime, type AgentRuntime, type AgentRuntimeDependencies } from "./agentRuntime"
import type { AgentReliabilityFlags } from "./reliabilityFlags"
import type { SolveSession } from "../services/solveSession"
import { agentNextPhaseFlags } from "./featureFlags"
import { createLocalPlanner, localIntentSkillIds } from "./localPlanner"
import { createModelPlanner, resolveActiveProvider, type ModelPlannerDependencies } from "./modelPlanner"

/** One production runtime assembler shared by UI and the offline/real evaluation adapter. */
export interface ProblemSolveInput {
  context: SolveContext
  session: SolveSession
  flags: AgentReliabilityFlags
  hashText: HashText
  runtime: AgentRuntimeDependencies
  /** W4：图像证据流水线审计出的缺口（宿主产生，模型不可伪造）。 */
  imageGaps?: readonly { code: string; message: string; required: boolean }[]
}

export interface ProblemPlannerSelection {
  planner: PlannerPort
  requestedSkillIds: readonly string[]
  textProfileId: string
  diagramPrompt?: string
}
export interface PlannerRouteInput {
  prompt: string
  imageNotes: string
  modelPlanner?: ModelPlannerDependencies
  planner?: PlannerPort
  solveSession?: SolveSession
  requiredGoals?: readonly { goalId: string; kind: string; sourceText: string }[]
  onDiagnostic?: (line: string) => void
}

/** Same deterministic/provider/offline router for the UI and evaluation. */
export async function selectProblemPlanner(input: PlannerRouteInput): Promise<ProblemPlannerSelection> {
  if (input.planner) return { planner: input.planner, requestedSkillIds: [], textProfileId: "local-planner" }
  const deterministic = routeDeterministicProblem(input.prompt)
  if (deterministic) return {
    planner: { plan: async () => ({ plan: deterministic.plan, requestId: "deterministic-request", attemptId: "deterministic-attempt" }) },
    diagramPrompt: deterministic.diagramPrompt, requestedSkillIds: [deterministic.family], textProfileId: "local-planner"
  }
  const resolution = await (input.modelPlanner?.resolveProvider ?? resolveActiveProvider)()
  if (!resolution.ok) {
    const options = { enableFreeApex: agentNextPhaseFlags().witnessSearch }
    return { planner: createLocalPlanner(options), requestedSkillIds: localIntentSkillIds(input.prompt, options), textProfileId: "local-planner" }
  }
  return {
    planner: createModelPlanner({ ...input.modelPlanner, imageNotes: input.imageNotes, solveSession: input.solveSession,
      requiredGoals: input.requiredGoals, resolveProvider: async () => resolution,
      onDiagnostic: (line) => { input.modelPlanner?.onDiagnostic?.(line); input.onDiagnostic?.(line) }
    }),
    requestedSkillIds: SKILL_MANIFESTS.map(manifest => manifest.id), textProfileId: resolution.provider.id
  }
}

/** Closed-domain facts are derived only from the user prompt, never from model output or options. */
export function deriveTrustedMathFacts(context: SolveContext): MathFact[] {
  if (context.understanding.goals.length !== 1) return []
  const prompt = context.prompt.replace(/\s+/g, "")
  const match = /^已知二次函数f\(t\)=([+-]?\d+)t(?:²|\^2)([+-]\d+)t([+-]\d+)，?t∈([[(])([+-]?\d+),([+-]?\d+)([)\]])，?求(最大|最小)值[。.]?$/.exec(prompt)
  if (!match) return []
  const coefficients = [Number(match[1]), Number(match[2]), Number(match[3])] as const
  const lower = Number(match[5]), upper = Number(match[6])
  if (![...coefficients, lower, upper].every(Number.isFinite) || lower >= upper) return []
  return [{ kind: "quadratic-interval", goalId: context.understanding.goals[0]!.goalId, quadratic: coefficients,
    interval: { lower, upper, lowerClosed: match[4] === "[", upperClosed: match[7] === "]" }, claim: match[8] === "最大" ? "max" : "min" }]
}

export function startProblemSolve(input: ProblemSolveInput): AgentRuntime {
  if (input.context.runId !== input.runtime.runId || input.session.signal.aborted)
    throw new Error("solve run and session identity mismatch")
  return createAgentRuntime({ ...input.runtime,
    ...(input.flags.goalTrackingV1 && input.flags.answerSemanticsV1
      ? { solveContext: input.context, hashText: input.hashText,
          ...(input.flags.mathVerificationV1 ? { trustedMathFacts: deriveTrustedMathFacts(input.context) } : {}),
          // 重读开关关闭时缺口照样要说出来：缺口不是"新能力"，而是"这一题没读到"。
          ...(input.imageGaps === undefined ? {} : { imageGaps: input.imageGaps }) }
      : {}) })
}
