import { routeDeterministicProblem, SKILL_MANIFESTS, conditionMathFacts, type HashText, type SolveContext, type MathFact, type PlannerPort } from "@draw/agent-core"
import { createAgentRuntime, type AgentRuntime, type AgentRuntimeDependencies } from "./agentRuntime"
import { validateReliabilityConfig, type AgentReliabilityFlags } from "./reliabilityFlags"
import type { SolveSession } from "../services/solveSession"
import { agentNextPhaseFlags } from "./featureFlags"
import { createLocalPlanner, localIntentSkillIds } from "./localPlanner"
import { createModelPlanner, resolveActiveProvider, type ModelPlannerDependencies } from "./modelPlanner"
import { chooseSolveStrategy } from "./solveStrategyPolicy"

/** One production runtime assembler shared by UI and the offline/real evaluation adapter. */
export interface ProblemSolveInput {
  context: SolveContext
  session: SolveSession
  flags: AgentReliabilityFlags
  hashText: HashText
  runtime: AgentRuntimeDependencies
  /** W4：图像证据流水线审计出的缺口（宿主产生，模型不可伪造）。 */
  imageGaps?: readonly { code: string; message: string; required: boolean }[]
  /** W8：用户是否授权过一个独立模型配置来做交叉验证（默认没有）。 */
  independentProfileAuthorized?: boolean
  /** W8：当前档位（只影响请求上限与路由说明，不改变授权前提）。 */
  solveMode?: "default" | "high_accuracy"
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
  const goalId = context.understanding.goals[0]!.goalId
  const facts: MathFact[] = []
  const prompt = context.prompt.replace(/\s+/g, "")
  const match = /^已知二次函数f\(t\)=([+-]?\d+)t(?:²|\^2)([+-]\d+)t([+-]\d+)，?t∈([[(])([+-]?\d+),([+-]?\d+)([)\]])，?求(最大|最小)值[。.]?$/.exec(prompt)
  if (match) {
    const coefficients = [Number(match[1]), Number(match[2]), Number(match[3])] as const
    const lower = Number(match[5]), upper = Number(match[6])
    if ([...coefficients, lower, upper].every(Number.isFinite) && lower < upper) {
      facts.push({ kind: "quadratic-interval", goalId, quadratic: coefficients,
        interval: { lower, upper, lowerClosed: match[4] === "[", upperClosed: match[7] === "]" }, claim: match[8] === "最大" ? "max" : "min" })
    }
  }
  // W6：题面条件 → 题族事实（圆锥曲线 / 有限概率 / 三角形）。模型给的坐标不进 facts。
  facts.push(...conditionMathFacts({ problemRevision: context.problemRevision,
    conditions: [{ id: "prompt", sourceText: context.prompt, goalIds: [goalId] }] }))
  return facts
}

export function startProblemSolve(input: ProblemSolveInput): AgentRuntime {
  if (input.context.runId !== input.runtime.runId || input.session.signal.aborted)
    throw new Error("solve run and session identity mismatch")
  /**
   * **W11：非法开关组合拒绝启动**（fail closed）。关闭某个开关只会让证据更保守，
   * 但"核验开着、目标跟踪关着"会让核验对象变成猜出来的目标 —— 那是假话，必须拒绝。
   */
  const config = validateReliabilityConfig(input.flags)
  if (!config.ok) throw new Error(`invalid reliability configuration: ${config.errors.map((error) => error.code).join(",")}`)
  return createAgentRuntime({ ...input.runtime,
    ...(input.flags.goalTrackingV1 && input.flags.answerSemanticsV1
      ? { solveContext: input.context, hashText: input.hashText,
          ...(input.flags.mathVerificationV1 ? { trustedMathFacts: deriveTrustedMathFacts(input.context) } : {}),
          // 重读开关关闭时缺口照样要说出来：缺口不是"新能力"，而是"这一题没读到"。
          ...(input.imageGaps === undefined ? {} : { imageGaps: input.imageGaps }),
          /**
           * **W8：把否证后的路由决定交给协调器**。授权与档位由调用方显式传入；
           * 没有授权时策略返回 `stop`，协调器会把原因写成 `refuted_no_independent_profile`，
           * 而**不会**偷偷换一个模型（换模型必须显式注入第二个规划器）。
           */
          refutationStrategy: ({ callsRemaining }) => chooseSolveStrategy({
            failure: "refuted", mode: input.solveMode ?? "default", callsRemaining,
            hasAuthorizedIndependentProfile: input.independentProfileAuthorized === true
          }) === "independent" ? "independent" : "stop" }
      : {}) })
}
