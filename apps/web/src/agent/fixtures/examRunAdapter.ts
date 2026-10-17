import {
  compilePlan,
  errorDiagnostics,
  examTrialVerdictOf,
  type ExamCase,
  type ExamRunCaseResult,
  type ExamRunBudget,
  type PlanOutcome
} from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"

import { planWorkspaceFor } from "../agentRunner"
import { planRequestFor } from "./benchmarkPlanningEval"
import { budgetWithProviderRequestCap } from "./examRequestBudget"
import { createCoordinatedExamRunCase } from "./examRunCoordinated"
import { workspaceForFamily, type ExamRunAdapterDeps } from "./examRunContracts"
export { workspaceForFamily, type ExamRunAdapterDeps } from "./examRunContracts"

/**
 * **把一次试验接到 Task 20 的记账上**（授权到了就是"跑一条命令"里的那一步）。
 *
 * ## 它做什么（2026-10-14 起：**规划 + 编译**，不再只是"发一次请求"）
 *
 * 每题每次试验：**组装完整的产品请求**（`planRequestFor` → `buildPlanRequest`）→ 调产品侧的
 * 规划器端口（`createModelPlanner()`）→ 把拿回来的计划交给**同一个** `compilePlan`
 * （六层编译 + 题设核验）→ 按 `examTrialVerdictOf` 记结局与**失败层**。
 *
 * 为什么必须走到编译那一步：计划原文要的是 plan / schema / 构造 / 核验 / 可读性**五层**的
 * 失败分布。只发一次请求，报告里就只有 planning 一层 —— 其余四层**没有落点**，
 * 而"没有落点"会被读成"那四层没问题"，与"没测"是相反的两件事。
 *
 * ## 它修掉的一条真缺陷（2026-10-14）
 *
 * 上一版给规划器的请求是 `{ run, userMessage } as never`。**真实**的
 * `createModelPlanner().plan()` 头一件事就是读 `request.model.context`
 * （组装提示词），后面还要 `request.budget` / `request.signal` / `request.run` ——
 * 少了它们会在**任何请求发出之前**抛 `TypeError`（本仓的 planning 评测踩过同一个坑，
 * 注释就写在 `benchmarkPlanningEval.ts` 的 `planRequestFor` 上）。
 * 后果不是"跑失败"，是更坏的：付费那一跑会**看起来在跑**、36 条全记 `error`、
 * 实际一个 token 都没花。现在请求由 `planRequestFor` 组装，形状与产品那一次相同。
 *
 * ## 它刻意不做的事（三条边界，都写在返回值或报告上）
 *
 * 1. **不自己算钱**：费用由调用方注入的 `costOf` 给 —— 价格表在 provider 那一侧，
 *    这一层编一个数就等于伪造成本读数；
 * 2. **不吞异常**：规划器抛了就记 `error`（`detail` 带上原文），不假装"这次没跑"；
 * 3. **不驱动修复回路**：修复发生在协调器的编译回路里，**这个端口看不到它** ⇒
 *    这一层永远传 `repaired: false`，报告里如实记 `repairPath: "not-driven"`。
 *    于是 `repairedCount === 0` 的含义只有一个：**这一轮没走协调器**
 *    （不许读成"产品没有修复过"，也不许把"修了一次才成"记成一次成功）。
 */



/** 一次试验的适配器（`runExamEvaluation` 的 `runCase` 就是它）。 */
export function createExamRunCase(deps: ExamRunAdapterDeps): (examCase: ExamCase, trial: number, budget?: ExamRunBudget) => Promise<ExamRunCaseResult> {
  if (deps.repairPath === "coordinator-driven") return createCoordinatedExamRunCase(deps)
  const now = deps.now ?? (() => Date.now())
  return async (examCase, trial, budget) => {
    const started = now()
    const runId = `exam-${examCase.id}-${trial}`
    const workspace = deps.workspaceOf?.(examCase) ?? workspaceForFamily(examCase.family)
    const document = createEmptyDocument(workspace)
    const cost = (outcome: PlanOutcome | null, error: unknown) => deps.costOf({ examCase, trial, outcome, error })

    let outcome: PlanOutcome
    try {
      const request = planRequestFor(examCase.prompt, workspace, runId, document)
      if (budget !== undefined) {
        const capped = budgetWithProviderRequestCap(request.budget, budget)
        request.budget = capped
        request.beforeProviderRequest = capped.beforeProviderRequest
      }
      outcome = await deps.planner.plan(request)
    } catch (error) {
      return {
        outcome: examTrialVerdictOf({ kind: "error" }).outcome,
        costUsd: cost(null, error),
        latencyMs: now() - started,
        detail: `规划器抛了：${error instanceof Error ? error.message : String(error)}`
      }
    }

    const envelope = outcome.plan
    if (envelope.kind !== "plan") {
      const verdict = examTrialVerdictOf({ kind: envelope.kind === "clarification" ? "clarification" : "answer" })
      return {
        outcome: verdict.outcome,
        ...(verdict.failureLayer === undefined ? {} : { failureLayer: verdict.failureLayer }),
        costUsd: cost(outcome, null),
        latencyMs: now() - started,
        detail: `规划器给的不是计划（kind=${envelope.kind}）。`
      }
    }

    /**
     * **编译前换工作区**（与协调器 `prepareWorkspaceFor` 同一处判据 `planWorkspaceFor`）：
     * 产品在编译这条计划之前会真的切过去，切工作区就是换一份空文档 —— 这里按同一件事做，
     * 否则"计划要求另一个工作区"会被编译器的守卫拒掉，而产品那边它本来是能成的。
     */
    const target = planWorkspaceFor(envelope) ?? workspace
    const compileDocument = target === workspace ? document : createEmptyDocument(target)
    const compiled = compilePlan(envelope, {
      document: compileDocument,
      prompt: examCase.prompt,
      conversationId: runId,
      documentGeneration: compileDocument.revision,
      ...(deps.compileFlags ?? {})
    })

    const errors = errorDiagnostics(compiled.diagnostics)
    const verdict = examTrialVerdictOf({
      kind: "plan",
      // 端口这一层看不到协调器的修复回路 ⇒ 一律 `false`（报告里的 `repairPath` 会说清这件事）。
      repaired: false,
      compile: {
        accepted: compiled.ok,
        // **按编译顺序**给（`errorStages` 只看第一条，见 `examFailureLayerForStages`）。
        errorStages: errors.map((diagnostic) => diagnostic.stage),
        ...(compiled.diagramVerification === undefined ? {} : { verification: compiled.diagramVerification.status })
      }
    })
    return {
      outcome: verdict.outcome,
      ...(verdict.failureLayer === undefined ? {} : { failureLayer: verdict.failureLayer }),
      costUsd: cost(outcome, null),
      latencyMs: now() - started,
      detail: compiled.ok
        ? `编译通过；题设核验：${compiled.diagramVerification?.status ?? "（这一轮没有核验报告）"}。`
        : `编译未通过（${errors.slice(0, 3).map((diagnostic) => `${diagnostic.stage}/${diagnostic.code}: ${diagnostic.detail}`).join(" | ")}）。`
    }
  }
}
