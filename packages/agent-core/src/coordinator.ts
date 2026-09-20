import type { Budget } from "./budget"
import { parsePlanEnvelope } from "./schemas"
import type { PlanEnvelope, RunContext } from "./contracts"
import type { CancelReason, CancelResult, CommitterPort, ConsentToken, ObserverPort, PlannerPort, ToolPort } from "./coordinatorPorts"
import { createBudget, type BudgetLimits } from "./budget"
import { createRunLedger, type RunEvent, type RunLedger } from "./runState"

/**
 * **协调器**（Task 2.1）。
 *
 * 它是"谁在什么时候能做什么"的唯一裁决者，而它自己**不做任何 IO** ——
 * 模型、场景、编译提交、只读工具全部是注入的端口（见 `coordinatorPorts.ts`）。
 *
 * 五条纪律，逐条都有用例：
 * 1. **模型输出永远不可信**：`plan` 端口回来的东西必须过 `parsePlanEnvelope`。解析失败 =
 *    一次"可见的修复机会"（计划 Task 2.3 的 repair 通道），用完仍是失败则整次运行 `failed`。
 * 2. **缺事实不许猜**：计划信封引用的 `factId` 必须在观察结果里。缺了就走 `waiting`
 *    （**不是**失败）—— 问用户比编一个数字好。
 * 3. **写入只有一条路**：`CommitterPort.commit`，且必须带 `ConsentToken`。协调器**不构造**同意凭据，
 *    只把它从调用方传下去。
 * 4. **取消可传播**：一个 `AbortController` 贯穿所有端口；取消后**不再发出任何事件**，
 *    也就不会有迟到结果写进账本（计划 Step 5）。
 * 5. **预算是闸不是装饰**：每一步之前 `budget.consume(...)`，被拒即停止；预算被拒**不改文档**。
 */

export interface CoordinatorDependencies {
  planner: PlannerPort
  observer: ObserverPort
  committer: CommitterPort
  tools?: ToolPort
  /** 已由宿主创建的同意凭据；没有它就只能停在 `awaiting_confirmation`。 */
  consent?: ConsentToken
  limits?: Partial<BudgetLimits>
  now?: () => number
  /** 每次运行拿到的预算；默认按 `limits` 新建。注入点供测试观察用量。 */
  budget?: Budget
  /**
   * **编译之前**的一次准备机会（例如把工作区切到这条计划需要的那个）。
   *
   * 为什么需要它：动作编译器会拒绝"工作区不匹配"的动作（`solid.create_template` 在
   * 平面几何里会被拒），而**用户在 Agent 里说"建一个立方体"时，画布可能停在平面几何**。
   * 没有这一步，用户就必须先自己切工作区再重发一次 —— 那不是"对话式作图"。
   *
   * 它拿得到的是**已校验的计划**（不是模型的原始输出），所以准备逻辑可以放心读 `actions`。
   * 返回 `ok: false` 时协调器停在 `failed` 并把原因带出来（例如"这条指令需要先离开工程制图"）。
   */
  prepare?: (plan: PlanEnvelope) => { ok: true } | { ok: false; detail: string }
}

export interface StartRequest {
  run: RunContext
  userMessage: string
  /** 用户在预览里点了确认；没有它协调器不会尝试提交。 */
  confirmed?: boolean
}

export interface AgentCoordinator {
  start(request: StartRequest): AsyncIterable<RunEvent>
  cancel(reason?: CancelReason): CancelResult
  /** 供宿主在取消/中断之后查询账本（计划 Step 5 的 "unless commit status is queried by idempotency key"）。 */
  ledger(): readonly RunEvent[]
  phase(): RunEvent["phase"]
}

/** 只允许一次修复尝试（计划 Task 2.3：可见的一次性 schema 修复）。 */
const MAX_PLAN_ATTEMPTS = 2

export function createCoordinator(dependencies: CoordinatorDependencies): AgentCoordinator {
  const now = dependencies.now ?? (() => Date.now())
  let ledger: RunLedger | null = null
  let controller: AbortController | null = null
  let cancelled = false

  function cancel(reason: CancelReason = "user"): CancelResult {
    if (!ledger) return { cancelled: false, phase: "created" }
    if (ledger.finished()) return { cancelled: false, phase: ledger.phase() }
    cancelled = true
    // 端口负责真的中断自己的 IO；协调器只保证信号发出去、之后不再发事件。
    controller?.abort()
    ledger.transition(reason === "interrupted" ? "interrupted" : "cancelled", reason === "interrupted" ? "the app was interrupted" : "the user cancelled the run")
    return { cancelled: true, phase: ledger.phase() }
  }

  async function* run(request: StartRequest): AsyncGenerator<RunEvent> {
    const budget = dependencies.budget ?? createBudget(dependencies.limits)
    ledger = createRunLedger({ runId: request.run.runId, promptMessageId: request.run.promptMessageId, handle: request.run.target, now })
    controller = new AbortController()
    const signal = controller.signal

    const started = ledger.transition("preflight", "checking capabilities and the target handle", { handle: request.run.target })
    if (started.ok) yield started.event

    try {
      // ---- 观察场景 ----------------------------------------------------
      if (!spend(budget, "tool")) return yield* stop("budget_tool")
      const observing = ledger.transition("observing", "reading the scene")
      if (observing.ok) yield observing.event
      const observation = await dependencies.observer.observe({ run: request.run, signal })
      if (cancelled) return
      ledger.record(`observed ${observation.factIds.length} confirmed fact(s)`, { requestId: null })

      // ---- 向模型要计划 ------------------------------------------------
      if (!spend(budget, "generation")) return yield* stop("budget_generation")
      if (!spend(budget, "network")) return yield* stop("budget_network")
      const planning = ledger.transition("planning", "asking for a plan")
      if (planning.ok) yield planning.event

      let parsed: PlanEnvelope | null = null
      let lastDetail = ""
      /**
       * `requestId` / `attemptId` 在**第一次往返之后**才知道，而 `planning` 事件在往返之前就发出来了。
       * 所以这里把它们挂到"计划已到手"的那条事件上（`ledger.record` 的 patch 会累积到后续事件），
       * 这样"哪个请求、哪次尝试产生了这份计划"始终可查 —— 计划 Step 4 要的正是这个。
       */
      let lastAttemptIds: { requestId: string; attemptId: string } | null = null
      for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS && parsed === null; attempt += 1) {
        if (attempt > 1) {
          // 第二次尝试是**可见的修复**：它花掉的是同一份预算的另一个名额。
          if (!spend(budget, "generation") || !spend(budget, "network")) return yield* stop("budget_repair")
        }
        const outcome = await dependencies.planner.plan({ run: request.run, userMessage: request.userMessage, budget, signal })
        if (cancelled) return
        lastAttemptIds = { requestId: outcome.requestId, attemptId: outcome.attemptId }
        ledger.record(`plan attempt ${attempt} returned`, lastAttemptIds)

        const result = parsePlanEnvelope(outcome.plan)
        if (result.ok) {
          parsed = result.value
          break
        }
        lastDetail = result.errors.map((error) => `${error.code}@${error.path}`).join(", ").slice(0, 512)
        ledger.record(`plan attempt ${attempt} was rejected: ${lastDetail}`)
      }

      if (parsed === null) {
        const failed = ledger.transition("failed", `the plan never matched the schema: ${lastDetail}`, lastAttemptIds ?? undefined)
        if (failed.ok) yield failed.event
        return
      }

      // ---- 缺事实 → 等用户补充（不是失败） --------------------------------
      const known = new Set(observation.factIds)
      const missing = parsed.factIds.filter((factId) => !known.has(factId))
      if (missing.length > 0) {
        const waiting = ledger.transition("waiting", `waiting for the user to confirm: ${missing.join(", ")}`)
        if (waiting.ok) yield waiting.event
        return
      }

      // ---- 只读回答：没有动作，走显式的 `answering` 路径 --------------------
      if (parsed.kind !== "plan") {
        const answering = ledger.transition("answering", parsed.kind === "answer" ? "answering from the scene" : "asking the user a clarifying question")
        if (answering.ok) yield answering.event
        if (parsed.kind === "clarification") {
          const waiting = ledger.transition("waiting", "waiting for the user's answer")
          if (waiting.ok) yield waiting.event
          return
        }
        const completed = ledger.transition("completed", "the run produced no draft")
        if (completed.ok) yield completed.event
        return
      }

      // ---- 草稿：编译 → 校验 → 等确认 → 提交 -------------------------------
      // 编译之前给宿主一次准备机会（例如切到这条计划需要的工作区）。
      // 放在编译**之前**是必须的：工作区不匹配的动作会被编译器直接拒。
      if (dependencies.prepare) {
        const prepared = dependencies.prepare(parsed)
        if (!prepared.ok) {
          const failed = ledger.transition("failed", `could not prepare the target: ${prepared.detail}`)
          if (failed.ok) yield failed.event
          return
        }
      }

      const actionCount = parsed.actions.length
      if (!spend(budget, "actions_per_stage", actionCount)) return yield* stop("budget_actions_per_stage")
      if (!spend(budget, "actions_per_run", actionCount)) return yield* stop("budget_actions_per_run")

      const compiling = ledger.transition("compiling", `staging ${actionCount} action(s)`)
      if (compiling.ok) yield compiling.event

      const staged = await dependencies.committer.stage({ run: request.run, actionCount, actions: parsed.actions, signal })
      if (cancelled) return
      if (!staged.ok) {
        // 草稿过期不是失败：文档被改过，重新暂存即可（协调器把决定权交回调用方）。
        const detail = `${staged.reason}${staged.detail ? `: ${staged.detail}` : ""}`
        const failed = ledger.transition("failed", detail)
        if (failed.ok) yield failed.event
        return
      }
      ledger.record(`draft v${staged.draftVersion} staged`, { draftVersion: staged.draftVersion })

      const validating = ledger.transition("validating", "checking the staged draft against the document")
      if (validating.ok) yield validating.event

      /**
       * **永远先停在 `awaiting_confirmation`**，哪怕调用方这次已经带上了 `confirmed`。
       *
       * 我第一版在这里走了 `validating → committing` 的捷径（有同意就跳过确认状态），
       * 结果被转移表当场拒绝（`illegal_transition`）—— 那条捷径是错的：
       * 确认状态不是"等用户点按钮"的 UI 细节，而是**账本必须留下的记录**。
       * 跳过它，事后就无法区分"用户确认过"与"调用方直接调了提交"。
       */
      const confirming = ledger.transition("awaiting_confirmation", "waiting for the user to confirm the preview")
      if (confirming.ok) yield confirming.event

      if (!request.confirmed || !dependencies.consent) return

      const committing = ledger.transition("committing", "applying the confirmed draft")
      if (committing.ok) yield committing.event

      const outcome = await dependencies.committer.commit({ run: request.run, actionCount, actions: parsed.actions, signal, consent: dependencies.consent })
      if (cancelled) return

      if (outcome.status === "committed" || outcome.status === "no_change") {
        ledger.record(`commit ${outcome.status}`, { handle: outcome.handle ?? request.run.target })
        const completed = ledger.transition("completed", outcome.status === "committed" ? "the document was updated" : "nothing needed to change")
        if (completed.ok) yield completed.event
        return
      }

      // 提交被拒：如实失败，绝不假装成功（计划 G2 Gate："model claims success without receipt" 是不允许的）。
      const failed = ledger.transition("failed", `commit refused: ${outcome.status}${outcome.detail ? ` (${outcome.detail})` : ""}`)
      if (failed.ok) yield failed.event
    } catch (error) {
      // provider 失败等异常统一落到 `failed`；已取消时不再补一条失败事件（取消已经是终态）。
      if (cancelled || (ledger?.finished() ?? true)) return
      const failed = ledger.transition("failed", describe(error))
      if (failed.ok) yield failed.event
    }
  }

  function spend(budget: Budget, kind: Parameters<Budget["consume"]>[0], amount = 1): boolean {
    return budget.consume(kind, amount).ok
  }

  /** 预算被拒：**什么都不做**（不改文档），如实落到 failed 并说明是哪一项额度用尽。 */
  function* stop(reason: string): Generator<RunEvent> {
    const failed = ledger?.transition("failed", `budget exhausted: ${reason}`)
    if (failed?.ok) yield failed.event
  }

  function describe(error: unknown): string {
    return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 512)
  }

  return {
    start(request) {
      return run(request)
    },
    cancel,
    ledger() {
      return ledger?.ledger() ?? []
    },
    phase() {
      return ledger?.phase() ?? "created"
    }
  }
}
