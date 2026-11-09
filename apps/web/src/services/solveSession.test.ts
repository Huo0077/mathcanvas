import { describe, expect, it } from "vitest"
import { createSolveSession } from "./solveSession"

const limits = { requests: 2, inputTokens: 1000, outputTokens: 1000, wallTimeMs: 1000 }

describe("one request and token ledger from image reading through planning", () => {
  it("spends the same call allowance on vision and planning", () => {
    const s = createSolveSession("s1", { ...limits, requests: 1 }, () => 0)
    const r = s.reserve("vision", 100, 200)!
    s.settle(r.id, { inputTokens: 90, outputTokens: 100 })
    expect(s.reserve("plan", 100, 200)).toBeNull()
    expect(s.snapshot().requests).toBe(1)
  })
  it("pre-reserves concurrent calls and does not release allowance on failure", () => {
    const s = createSolveSession("s2", limits, () => 0)
    const a = s.reserve("vision", 100, 200)!
    const b = s.reserve("repair", 100, 200)!
    expect(a.id).not.toBe(b.id)
    expect(s.reserve("independent", 1, 1)).toBeNull()
    expect(s.snapshot().pending).toBe(2)
    s.settle(a.id)
    expect(s.snapshot().inputTokens).toBe(200)
    expect(s.snapshot().outputTokens).toBe(400)
    expect(s.snapshot().pending).toBe(1)
  })
  it("settles usage only once; missing usage keeps the conservative reservation", () => {
    const s = createSolveSession("s3", limits, () => 0)
    const a = s.reserve("plan", 100, 200)!
    s.settle(a.id, { inputTokens: 60, outputTokens: 80 })
    s.settle(a.id, { inputTokens: 999, outputTokens: 999 })
    expect(s.snapshot()).toMatchObject({ requests: 1, inputTokens: 60, outputTokens: 80, pending: 0 })
    const b = s.reserve("plan", 900, 900)!
    expect(b).toBeDefined()
    s.settle(b.id)
    expect(s.snapshot().inputTokens).toBe(960)
    expect(s.snapshot().outputTokens).toBe(980)
  })
  it("rejects overcommit before the model call and preserves unused capacity", () => {
    const s = createSolveSession("s4", { ...limits, requests: 8 }, () => 0)
    expect(s.reserve("vision", 1001, 1)).toBeNull()
    expect(s.snapshot().requests).toBe(0)
    expect(s.reserve("vision", 500, 800)).not.toBeNull()
    expect(s.reserve("repair", 501, 1)).toBeNull()
    expect(s.snapshot().requests).toBe(1)
  })
  it("cancellation propagates and later attempts cannot spend", () => {
    const s = createSolveSession("s5", limits, () => 0)
    s.cancel("user stop")
    expect(s.signal.aborted).toBe(true)
    expect(s.reserve("plan", 1, 1)).toBeNull()
  })
})

describe("paused user review does not reset paid usage", () => {
  it("pauses active wall time but refuses a session past 30 minutes", () => {
    let time = 0
    const s = createSolveSession("s6", limits, () => time)
    const first = s.reserve("vision", 1, 1)!
    s.settle(first.id)
    time = 500
    s.pauseForUser()
    expect(s.reserve("plan", 1, 1)).toBeNull()
    time = 1200
    expect(s.resume()).toBe(true)
    expect(s.snapshot().requests).toBe(1)
    expect(s.reserve("plan", 1, 1)).not.toBeNull()
    time = 1800001
    expect(s.resume()).toBe(false)
    expect(s.reserve("plan", 1, 1)).toBeNull()
  })
  it("active time and missing input are validated", () => {
    let time = 0
    const s = createSolveSession("s7", limits, () => time)
    expect(s.reserve("vision", -1, 1)).toBeNull()
    expect(s.reserve("plan", 1, Number.NaN)).toBeNull()
    time = 1001
    expect(s.reserve("plan", 1, 1)).toBeNull()
  })
})

it("does not let a settled request reserve more than the total token budget", () => {
  const s = createSolveSession("s8", { requests: 2, inputTokens: 100, outputTokens: 100, wallTimeMs: 1000 }, () => 0)
  const r = s.reserve("plan", 100, 100)!
  s.settle(r.id, { inputTokens: 150, outputTokens: 150 })
  expect(s.snapshot().inputTokens).toBe(150)
  expect(s.snapshot().outputTokens).toBe(150)
  expect(s.reserve("plan", 1, 1)).toBeNull()
})

it("default admission requires settled usage or a conservative reservation", () => {
  const s = createSolveSession("provisional", { requests: 3, inputTokens: 100, outputTokens: 100, wallTimeMs: 1000 }, () => 0)
  const r = s.reserve("vision", 50, 50)!
  s.settle(r.id, { inputTokens: 40 })
  expect(s.snapshot()).toMatchObject({ inputTokens: 40, outputTokens: 50 })
})

it("usage beyond reservation closes the ledger to later requests", () => {
  const s = createSolveSession("over", { requests: 3, inputTokens: 100, outputTokens: 100, wallTimeMs: 1000 }, () => 0)
  const r = s.reserve("plan", 70, 80)!
  s.settle(r.id, { inputTokens: 150, outputTokens: 120 })
  expect(s.snapshot()).toMatchObject({ inputTokens: 150, outputTokens: 120 })
  expect(s.reserve("plan", 1, 1)).toBeNull()
})

it("native model invocation cannot proceed without a successful reservation", async () => {
  const { runReservedModel } = await import("./solveSession")
  const s = createSolveSession("native", { requests: 1, inputTokens: 100, outputTokens: 100, wallTimeMs: 1000 }, () => 0)
  let calls = 0
  const run = async () => { calls += 1; return { ok: true as const, events: [{ kind: "usage" as const, requestId: "req-1", attemptId: "attempt-1", inputTokens: 15, outputTokens: 10 }] } }
  await runReservedModel(s, "vision", 20, 30, run)
  await expect(runReservedModel(s, "plan", 20, 30, run)).rejects.toThrow(/budget|limit/i)
  expect(calls).toBe(1)
  expect(s.snapshot()).toMatchObject({ requests: 1, inputTokens: 15, outputTokens: 10, pending: 0 })
})

it("one running attempt can be aborted while a model call is in flight", async () => {
  const { runReservedModel } = await import("./solveSession")
  const s = createSolveSession("abort", { requests: 2, inputTokens: 100, outputTokens: 100, wallTimeMs: 1000 }, () => 0)
  s.cancel("user")
  let touched = false
  await expect(runReservedModel(s, "vision", 1, 1, async () => { touched = true; return { ok: true, events: [] } })).rejects.toThrow(/budget|limit/i)
  expect(touched).toBe(false)
})

it("lease handoff pins one paid ledger to a submitted prompt instead of the current tab", async () => {
  const { attachSolveSession, claimSolveSession, dropSolveSession } = await import("./solveSession")
  const s = createSolveSession("handoff", limits, () => 0)
  expect(attachSolveSession("conversation-a", "题图A", s)).toBe(true)
  expect(claimSolveSession("conversation-b", "题图A")).toBeNull()
  expect(claimSolveSession("conversation-a", "题图A")).toBe(s)
  expect(claimSolveSession("conversation-a", "题图A")).toBeNull()
  dropSolveSession(s)
})


it("default run and image composer share exactly one default budget policy", async () => {
  const { createDefaultSolveSession, DEFAULT_SOLVE_SESSION_LIMITS } = await import("./solveSession")
  expect(DEFAULT_SOLVE_SESSION_LIMITS).toMatchObject({ requests: 8, inputTokens: 96000, outputTokens: 16000, wallTimeMs: 180000 })
  const s = createDefaultSolveSession("default", () => 0)
  expect(s.snapshot().requests).toBe(0)
  for (let i = 0; i < 8; i++) { const r = s.reserve("plan", 10, 10)!; expect(r).not.toBeNull(); s.settle(r.id) }
  expect(s.reserve("plan", 10, 10)).toBeNull()
})


it("a paused review can resume, and an expired lease can never be silently replaced", async () => {
  const { attachSolveSession, claimSolveSession } = await import("./solveSession")
  let now = 0
  const s = createSolveSession("old", limits, () => now)
  s.pauseForUser()
  expect(attachSolveSession("conv-expired", "求面积", s)).toBe(true)
  now = 1_800_001
  expect(claimSolveSession("conv-expired", "求面积")).toBe(s)
  expect(s.resume()).toBe(false)
})


it("stop while a request is pending discards the late response rather than delivering it", async () => {
  const { runReservedModel } = await import("./solveSession")
  const s = createSolveSession("late", limits, () => 0)
  let complete!: (result: { ok: true; events: [] }) => void
  const inflight = runReservedModel(s, "plan", 10, 10, () => new Promise<{ ok: true; events: [] }>(resolve => { complete = resolve }))
  s.cancel("user")
  complete({ ok: true, events: [] })
  await expect(inflight).rejects.toThrow(/cancel/i)
  expect(s.snapshot()).toMatchObject({ requests: 1, pending: 0 })
})


it("session tracks reported usage separately from provisional reservations", () => {
  const s = createSolveSession("usage", limits, () => 0)
  const r = s.reserve("vision", 200, 400)!
  expect(s.snapshot()).toMatchObject({ inputTokens: 200, outputTokens: 400, reportedInputTokens: 0, reportedOutputTokens: 0, usageReportedRequests: 0 })
  s.settle(r.id, { inputTokens: 30, outputTokens: 40 })
  expect(s.snapshot()).toMatchObject({ inputTokens: 30, outputTokens: 40, reportedInputTokens: 30, reportedOutputTokens: 40, usageReportedRequests: 1 })
  const r2 = s.reserve("plan", 100, 200)!
  s.settle(r2.id)
  expect(s.snapshot()).toMatchObject({ inputTokens: 130, outputTokens: 240, reportedInputTokens: 30, reportedOutputTokens: 40, usageReportedRequests: 1 })
})


it("pending handoff cannot be attached twice and a different prompt clears stale provenance", async () => {
  const { attachSolveSession, claimSolveSession } = await import("./solveSession")
  const one = createSolveSession("one", limits, () => 0)
  const two = createSolveSession("two", limits, () => 0)
  expect(attachSolveSession("new-conversation", "旧题", one)).toBe(true)
  expect(attachSolveSession("new-conversation", "新题", two)).toBe(false)
  expect(claimSolveSession("new-conversation", "新题")).toBeNull()
  expect(one.signal.aborted).toBe(true)
  expect(attachSolveSession("new-conversation", "新题", two)).toBe(true)
  expect(claimSolveSession("new-conversation", "新题")).toBe(two)
})


it("pins provider identity and revision per vision and plan stage without storing credentials", () => {
  const s = createSolveSession("profiles", limits, () => 0)
  expect(s.pinProvider("vision", "vision-1", 2)).toBe(true)
  expect(s.pinProvider("vision", "vision-1", 2)).toBe(true)
  expect(s.pinProvider("vision", "vision-1", 3)).toBe(false)
  expect(s.pinProvider("plan", "text-2", 7)).toBe(true)
  expect(s.pinProvider("plan", "text-3", 7)).toBe(false)
  expect(s.snapshot().providers).toEqual({ vision: { id: "vision-1", revision: 2 }, plan: { id: "text-2", revision: 7 } })
  expect(JSON.stringify(s.snapshot())).not.toMatch(/secret|apiKey/i)
})


it("a high accuracy request limit is distinct from default and still counts vision", async () => {
  const { HIGH_ACCURACY_SOLVE_SESSION_LIMITS } = await import("./solveSession")
  expect(HIGH_ACCURACY_SOLVE_SESSION_LIMITS.requests).toBe(12)
  const s = createSolveSession("high", HIGH_ACCURACY_SOLVE_SESSION_LIMITS, () => 0)
  const vision = s.reserve("vision", 100, 100)!
  s.settle(vision.id)
  for (let i = 0; i < 11; i++) { const r = s.reserve("plan", 100, 100)!; expect(r).not.toBeNull(); s.settle(r.id) }
  expect(s.snapshot().requests).toBe(12)
  expect(s.reserve("repair", 1, 1)).toBeNull()
})
