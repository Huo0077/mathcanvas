import { describe, expect, it } from "vitest"

import { createRunLedger, nextPhases, TERMINAL_PHASES, type RunPhase } from "./runState"

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
    if (!result.ok) expect(result.allowed).toEqual(["validating", "failed", "cancelled", "interrupted"])
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
