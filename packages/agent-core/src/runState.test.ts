import { describe, expect, it } from "vitest"

import { createRunLedger, boundTrace, MAX_TRACE_SUMMARY, nextPhases, TERMINAL_PHASES, type RunPhase } from "./runState"

/**
 * Task 2.1 Step 1：**状态机必须显式**。
 *
 * 计划给的路径是
 * `created → preflight → observing → planning → compiling → validating → awaiting_confirmation → committing → completed`，
 * 另有 waiting / failed / cancelled / interrupted 几条显式路径。
 * 下面把 Step 1 点名的场景逐条走一遍，并钉住几条**刻意不允许**的边。
 */
function walk(ledger: ReturnType<typeof createRunLedger>, phases: RunPhase[]) {
  for (const phase of phases) {
    const result = ledger.transition(phase)
    expect(result.ok, `expected to reach ${phase}`).toBe(true)
  }
}

/**
 * **计划 N4：「flag 状态进入 trace/benchmark 记录」。**
 *
 * 修前：五个开关只被当作布尔**消费**（`planCompiler` 的 context、`committerAdapter.nextPhaseFlags`），
 * **没有任何一处把它们写进 trace** —— 于是"这份 trace 是在哪组开关下取的"答不出来。
 * 现在它随 `RunRevisions` 一起进账本，而**每一条事件都带着 `revisions`**。
 *
 * 两条判据一正一反：**给了就一路带上**；**没给就不许编一个"全关"出来** ——
 * 后者与本节其余字段同一条纪律（"没接线"与"确认过是关的"是两件事）。
 */
describe("run revisions carry the next-phase flags (N4)", () => {
  const FLAGS = { obligationIR: true, witnessSearch: false, constrainedDrag: false, openProblemCompiler: false, proofExport: false }

  it("给了就随**每一条**事件带上（不是只带第一条）", () => {
    const ledger = createRunLedger({
      runId: "run-flags",
      promptMessageId: "msg-flags",
      revisions: { promptVersion: "p1", toolRegistryRevision: "t1", actionSchemaRevision: "a1", providerCapabilityRevision: "c1", nextPhaseFlags: FLAGS }
    })

    // 这两行原来被我写成 `transition("planning")` / `transition("acting")` —— 两相都**不合法**，
    // 于是测试红。修的时候一次 PowerShell 替换又把断言整段删掉，测试反而"通过"了 ——
    // 那是**假绿**（一个没有断言的空壳）。现在用 `nextPhases` 取合法下一相，并把两条事件都断言掉。
    const [firstPhase] = nextPhases("created")
    const firstEvent = ledger.transition(firstPhase, "start")
    expect(firstEvent.ok).toBe(true)
    if (firstEvent.ok) expect(firstEvent.event.revisions.nextPhaseFlags).toEqual(FLAGS)

    const [secondPhase] = nextPhases(firstPhase)
    const secondEvent = ledger.transition(secondPhase, "continue")
    if (!secondEvent.ok) throw new Error(`expected an event, got ${secondEvent.reason}`)
    // **每一条**都带，不是只带第一条。
    expect(secondEvent.event.revisions.nextPhaseFlags).toEqual(FLAGS)
  })

  it("**没接线就留空**：不许编一份「全关」冒充「确认过是关的」", () => {
    const ledger = createRunLedger({ runId: "run-no-flags", promptMessageId: "msg-no-flags" })
    const [phase] = nextPhases("created")
    const event = ledger.transition(phase, "start")

    if (!event.ok) throw new Error(`expected an event, got ${event.reason}`)
    expect(event.event.revisions.nextPhaseFlags).toBeUndefined()
  })
})
describe("run ledger happy paths", () => {
  it("walks a read-only run to completion without ever reaching a commit phase", () => {
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })

    // 只读问答：观察 → 规划 → 回答 → 完成。`answering` 是显式的：
    // 若允许 `planning → completed`，两种完全不同的运行会留下同一条事件序列，
    // 事后无法区分"回答完了"与"提交完了"。
    walk(ledger, ["preflight", "observing", "planning"])
    const finish = ledger.transition("answering", "answering from the scene without touching the document")
    expect(finish.ok).toBe(true)
    walk(ledger, ["completed"])

    expect(ledger.phase()).toBe("completed")
    expect(ledger.finished()).toBe(true)
    // 这条路径上一次都没进过编辑/提交阶段。
    const phases = ledger.ledger().map((event) => event.phase)
    expect(phases).not.toContain("compiling")
    expect(phases).not.toContain("committing")
  })

  it("walks a draft run through confirmation and commit", () => {
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })

    walk(ledger, ["preflight", "observing", "planning", "compiling", "validating", "awaiting_confirmation", "committing", "completed"])

    expect(ledger.phase()).toBe("completed")
    // 事件序列就是走过的路径（含起点之后每一次转移）。
    expect(ledger.ledger().map((event) => event.phase)).toEqual(["preflight", "observing", "planning", "compiling", "validating", "awaiting_confirmation", "committing", "completed"])
    expect(ledger.ledger().map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it("parks in waiting when a fact is missing, then resumes through observing", () => {
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    walk(ledger, ["preflight", "observing"])

    // 缺事实 → 等用户补充（`waiting` 与"等用户确认草稿"是两件事）。
    expect(ledger.transition("waiting", "need the radius of circle c1").ok).toBe(true)
    expect(ledger.phase()).toBe("waiting")

    // 用户回答之后要**重新观察**：场景可能已经变了，不能拿旧观察继续规划。
    walk(ledger, ["observing", "planning"])

    expect(ledger.phase()).toBe("planning")
  })

  it("goes back to compiling when the user revises the preview instead of re-planning", () => {
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    walk(ledger, ["preflight", "observing", "planning", "compiling", "validating", "awaiting_confirmation"])

    // 用户在预览里改了要求：规划产物（计划信封）没变，变的是要编译的动作。
    expect(ledger.transition("compiling", "user asked for a bigger radius").ok).toBe(true)
    walk(ledger, ["validating", "awaiting_confirmation", "committing", "completed"])

    expect(ledger.phase()).toBe("completed")
  })

  /**
   * **编译阶段的一次性修复 = 回到规划**（Agent DSL 切片 Task 4 的接线）。
   *
   * 这条边以前不存在，因为编译失败只能走向 `failed`：编译器给出的修复请求
   * （"只带 code/path/allowedChanges"）根本没有消费方。有了它，账本上才能看见
   * "这是同一份运行里的第二次规划"，而不是一次说不清来源的重试。
   */
  it("goes back to planning when the compile stage handed the model a repair request", () => {
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    walk(ledger, ["preflight", "observing", "planning", "compiling"])

    expect(ledger.transition("planning", "re-planning for the one repair").ok).toBe(true)
    walk(ledger, ["compiling", "validating", "awaiting_confirmation", "committing", "completed"])

    expect(ledger.phase()).toBe("completed")
    expect(ledger.ledger().map((event) => event.phase)).toEqual(["preflight", "observing", "planning", "compiling", "planning", "compiling", "validating", "awaiting_confirmation", "committing", "completed"])
  })
})

describe("run ledger explicit failure paths", () => {
  it("fails the run when the model output is invalid", () => {
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    walk(ledger, ["preflight", "observing", "planning"])

    expect(ledger.transition("failed", "output did not match the plan schema twice").ok).toBe(true)

    expect(ledger.phase()).toBe("failed")
    expect(TERMINAL_PHASES.has(ledger.phase())).toBe(true)
  })

  it("fails the run when a provider call fails", () => {
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    walk(ledger, ["preflight", "observing"])

    expect(ledger.transition("failed", "provider returned 401").ok).toBe(true)
    expect(ledger.phase()).toBe("failed")
  })

  it("cancels before commit and cancels during commit as different paths", () => {
    const before = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    walk(before, ["preflight", "observing", "planning", "compiling", "validating", "awaiting_confirmation"])
    expect(before.transition("cancelled", "user pressed stop").ok).toBe(true)
    expect(before.phase()).toBe("cancelled")

    // 提交途中的取消走的是同一条终态，但来源不同 —— 协调器据此决定要不要回滚/查询提交结果。
    const during = createRunLedger({ runId: "run-2", promptMessageId: "msg-2" })
    walk(during, ["preflight", "observing", "planning", "compiling", "validating", "awaiting_confirmation", "committing"])
    expect(during.transition("cancelled", "app closed while committing").ok).toBe(true)
    expect(during.phase()).toBe("cancelled")
  })

  it("marks an app interruption distinctly from a cancellation", () => {
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    walk(ledger, ["preflight", "observing", "planning"])

    // 中断不是用户的选择：恢复时应当可以查询幂等键，而取消不该被自动恢复。
    expect(ledger.transition("interrupted", "app restarted").ok).toBe(true)
    expect(ledger.phase()).toBe("interrupted")
  })

  it("treats a stale draft as a return to validating rather than a dead end", () => {
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    walk(ledger, ["preflight", "observing", "planning", "compiling", "validating", "awaiting_confirmation"])

    // 文档在预览之后被改过：草稿过期。这不是失败 —— 重新暂存即可。
    expect(ledger.transition("compiling", "the draft went stale after a manual edit").ok).toBe(true)
    expect(ledger.phase()).toBe("compiling")
  })
})

describe("run ledger refusals", () => {
  it("refuses to jump straight from created to observing", () => {
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })

    const result = ledger.transition("observing")

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("illegal_transition")
      // 拒绝时要把**允许的下一步**给出来，调用方才知道该怎么办。
      expect(result.allowed).toContain("preflight")
      expect(result.allowed).not.toContain("observing")
    }
    expect(ledger.phase()).toBe("created")
  })

  it("refuses to skip validating on the way to confirmation", () => {
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    walk(ledger, ["preflight", "observing", "planning", "compiling"])

    const result = ledger.transition("awaiting_confirmation")

    expect(result.ok).toBe(false)
    // `planning` 在这里是**编译阶段那次一次性修复**的返程边（见上面的用例）；
    // 它不允许跳过 `validating`，只是允许"回去重新规划一次"。
    if (!result.ok) expect(result.allowed).toEqual(["validating", "planning", "failed", "cancelled", "interrupted"])
  })

  it("refuses any further transition after the run finished", () => {
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    walk(ledger, ["preflight", "observing", "planning", "answering", "completed"])

    const result = ledger.transition("observing")

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("run_finished")
      expect(result.allowed).toEqual([])
    }
    // 账本没有被这次拒绝污染。
    expect(ledger.ledger()).toHaveLength(5)
  })

  it("discards a late event once the run has finished", () => {
    // 计划 Step 5：取消/结束之后到达的模型或 worker 结果必须被丢弃，
    // 否则一份已经结束的账本会被迟到结果改写。
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    walk(ledger, ["preflight", "observing", "planning", "compiling", "validating", "awaiting_confirmation", "committing", "completed"])

    expect(ledger.record("late provider chunk arrived")).toBeNull()
    expect(ledger.ledger()).toHaveLength(8)
  })
})

describe("run ledger event identity", () => {
  it("carries every identifier the plan names on every event", () => {
    const handle = { projectId: "p", documentId: "doc-1", workspace: "conics" as const, epoch: "epoch:doc-1", generation: 3, contentHash: "hash" }
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1", handle, now: () => 1_000 })

    ledger.transition("preflight", "capabilities checked", { requestId: "req-1" })
    ledger.transition("observing", "", { attemptId: "attempt-1" })
    ledger.transition("planning", "", { toolCallId: "tool-1" })
    ledger.record("staged one action", { draftVersion: 2 })

    for (const event of ledger.ledger()) {
      // 七个字段一个都不能缺（类型上全是必填，这里再从运行时确认一遍）。
      for (const key of ["runId", "promptMessageId", "requestId", "attemptId", "toolCallId", "draftVersion", "handle"] as const) {
        expect(event, `event ${event.sequence} is missing ${key}`).toHaveProperty(key)
      }
      expect(event.runId).toBe("run-1")
      expect(event.promptMessageId).toBe("msg-1")
      expect(event.at).toBe(1_000)
    }

    // 标识随事件累积：后来设的值会持续带上，而更早的事件保持当时的快照。
    expect(ledger.ledger()[0].requestId).toBe("req-1")
    expect(ledger.ledger()[0].toolCallId).toBeNull()
    expect(ledger.ledger()[3].draftVersion).toBe(2)
    expect(ledger.ledger()[3].toolCallId).toBe("tool-1")
  })

  it("keeps the handle on the event so a stale commit can be detected later", () => {
    const handle = { projectId: "p", documentId: "doc-1", workspace: "conics" as const, epoch: "epoch:doc-1", generation: 7, contentHash: "hash-7" }
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1", handle })

    const result = ledger.transition("preflight")

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.event.handle?.generation).toBe(7)
  })
})

describe("transition table", () => {
  it("gives terminal phases no outgoing edges at all", () => {
    for (const phase of TERMINAL_PHASES) expect(nextPhases(phase)).toEqual([])
  })

  it("lets every active phase be cancelled, failed or interrupted", () => {
    const active: RunPhase[] = ["created", "preflight", "observing", "planning", "compiling", "validating", "awaiting_confirmation", "committing", "waiting"]

    for (const phase of active) {
      const allowed = nextPhases(phase)
      expect(allowed, `${phase} must be cancellable`).toContain("cancelled")
      expect(allowed, `${phase} must be interruptible`).toContain("interrupted")
      expect(allowed, `${phase} must be failable`).toContain("failed")
    }
  })
})

/**
 * **运行痕迹**（Phase 6 / Task 6.1）。
 *
 * 计划的两条判据：每次运行记录四个版本号；每个 tool call 记录输入/结果摘要、
 * diff、verification、草稿版本与耗时 —— 而且**原文日志有界**，
 * 不许写密钥、推理过程与完整候选文档。
 */
describe("run revisions and tool traces", () => {
  const revisions = { promptVersion: "prompt.v6", toolRegistryRevision: "tools.1", actionSchemaRevision: "plan.v1", providerCapabilityRevision: "caps.1" }

  it("carries the four revisions on every event, not only the first", () => {
    /**
     * 为什么挂在每一条上：事件会被单独导出、单独贴进缺陷报告，
     * 而"这条读数是在哪版提示词/工具目录下产生的"是判断能否复现的第一个问题。
     * 只在首条记录，等于要求读者先去翻第一条。
     */
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1", revisions })

    walk(ledger, ["preflight", "observing", "planning"])

    expect(ledger.ledger().length).toBeGreaterThanOrEqual(3)
    for (const event of ledger.ledger()) expect(event.revisions).toEqual(revisions)
  })

  it("leaves the revisions empty instead of inventing a version when the caller did not wire them", () => {
    // 编一个假版本号会让"这份读数能不能复现"变成一句无法回答的话。
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    ledger.record("something happened")

    expect(ledger.ledger()[0].revisions).toEqual({ promptVersion: "", toolRegistryRevision: "", actionSchemaRevision: "", providerCapabilityRevision: "" })
  })

  it("records a tool trace and hands it back in order", () => {
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    const trace = { toolCallId: "c1", toolId: "scene.inspect", inputSummary: "doc-1", resultSummary: "2 entities", status: "success" as const, draftVersion: null, verification: null, diff: null, durationMs: 4 }

    expect(ledger.recordToolTrace(trace)).toEqual(trace)
    ledger.recordToolTrace({ ...trace, toolCallId: "c2" })

    expect(ledger.toolTraces().map((entry) => entry.toolCallId)).toEqual(["c1", "c2"])
  })

  it("refuses to append a trace after the run reached a terminal phase", () => {
    // 与 `record` 同一条纪律：迟到的工具结果不许写进一份已经结束的账本。
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    walk(ledger, ["preflight", "observing", "planning"])
    ledger.transition("failed", "boom")

    expect(ledger.recordToolTrace({ toolCallId: "c1", toolId: "scene.inspect", inputSummary: "", resultSummary: "", status: "error", draftVersion: null, verification: null, diff: null, durationMs: 1 })).toBeNull()
    expect(ledger.toolTraces()).toEqual([])
  })

  it("keeps trace summaries bounded and marks the truncation", () => {
    /**
     * 无界日志在真实运行里会把内存和界面一起拖垮，而"日志太长"通常以"把日志关掉"收场。
     * 截断必须**显式**（带上截掉多少），否则读者会把截断当成"原文就这么短"。
     */
    const long = "x".repeat(600)
    const bounded = boundTrace(long)

    expect(bounded.length).toBeLessThan(long.length)
    expect(bounded).toContain("(+")
    expect(bounded.startsWith("x".repeat(MAX_TRACE_SUMMARY))).toBe(true)
  })

  it("collapses whitespace so a multi-line payload cannot smuggle structure into a summary", () => {
    expect(boundTrace("first line\nsecond\tline")).toBe("first line second line")
  })

  it("returns a copy of the traces, so a caller cannot mutate the ledger", () => {
    const ledger = createRunLedger({ runId: "run-1", promptMessageId: "msg-1" })
    ledger.recordToolTrace({ toolCallId: "c1", toolId: "t", inputSummary: "", resultSummary: "", status: "success", draftVersion: null, verification: null, diff: null, durationMs: 0 })

    const taken = ledger.toolTraces() as unknown as { toolCallId: string }[]
    taken.push({ toolCallId: "injected" })

    expect(ledger.toolTraces()).toHaveLength(1)
  })
})