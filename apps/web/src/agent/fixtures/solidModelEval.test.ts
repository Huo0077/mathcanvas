// @vitest-environment node
import { createEmptyDocument } from "@draw/dsl"
import { PLAN_SCHEMA_VERSION, compilePlan } from "@draw/agent-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import defaultConfig from "../../../../../vitest.config"
import { parseSolidEvalArgs } from "../../../../../scripts/solid-eval/runner.mjs"
import { readSolidReport, writeSolidReport } from "../../../../../scripts/solid-eval/report-files.mjs"
import { FOLD_PROBLEMS, SOLID_PROBLEMS, type SolidProblem } from "./examSolid30.problems"
import { evaluateSolidPlan, isVerifiedSolidResult, replaySolidReport, runSolidEvaluation, summariseSolidEval, type SolidEvalReport } from "./solidModelEval"
import { createSolidEvalTransport, solidEvalConfig, type SolidEvalConfig } from "./solidEvalTransport"

const config: SolidEvalConfig = { apiKey: "test-credential-not-for-network", model: "fake", baseUrl: "https://example.invalid/v1", maxRequests: 2, maxTokens: 4096, timeoutMs: 100 }
const problem: SolidProblem = { id: "test", focus: "length", prompt: "三角形ABC中，AB=2。" }
const face = { actionId: "solid.create_face", actionKey: "base", factIds: [], inputs: { alias: "base", vertexNames: ["A", "B", "C"], vertices: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }] } }
const valid = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "test", factIds: [], actions: [face] }
const invalid = { ...valid, actions: [face, { actionId: "solid.create_segment", actionKey: "missing", factIds: [], inputs: { alias: "missing", vertexNames: ["X", "Y"] } }] }
const response = () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: "plan", function: { name: "plan_set_plan", arguments: JSON.stringify(valid) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 20, completion_tokens: 10 }, echo: config.apiKey }))
const request = { messages: [{ role: "user", content: "test" }], tools: [] }
afterEach(() => vi.useRealTimers())

describe("explicit live evaluation and offline scoring", () => {
  it("excludes live evaluation from npm test even with credentials and requires a numeric request cap", () => {
    expect((defaultConfig as { test: { exclude: string[] } }).test.exclude).toContain("apps/web/src/agent/fixtures/examSolid30.eval.test.ts")
    expect(() => solidEvalConfig({ DEEPSEEK_API_KEY: config.apiKey })).toThrow("requires")
    for (const cap of [undefined, "NaN", "0", "-1", "61", "1.5"]) {
      expect(() => solidEvalConfig({ DEEPSEEK_API_KEY: config.apiKey, MATHCANVAS_SOLID_EVAL_PAID: "1", DEEPSEEK_MAX_REQUESTS: cap })).toThrow("DEEPSEEK_MAX_REQUESTS")
    }
    expect(solidEvalConfig({ DEEPSEEK_API_KEY: config.apiKey, MATHCANVAS_SOLID_EVAL_PAID: "1", DEEPSEEK_MAX_REQUESTS: "36" }).maxRequests).toBe(36)
    expect(() => parseSolidEvalArgs([])).toThrow("--allow-paid")
    expect(() => parseSolidEvalArgs(["--allow-paid", "--max-requests", "NaN"])).toThrow("Invalid")
    expect(parseSolidEvalArgs(["--replay", "report.json"])).toMatchObject({ replay: "report.json" })
  })

  it("does not count a compiler failure even when its partial givens report passed", () => {
    const compiled = compilePlan(invalid, { document: createEmptyDocument("geometry3d"), prompt: problem.prompt })
    expect(compiled.ok).toBe(false)
    expect(compiled.diagramVerification?.status).toBe("passed")
    const row = evaluateSolidPlan(problem, invalid)
    expect(row.verified).toBe(false)
    expect(summariseSolidEval([row]).verified).toBe(0)
    expect(isVerifiedSolidResult({ kind: "plan", compiled: true, hasDraft: false, verification: "passed" })).toBe(false)
    expect(evaluateSolidPlan(problem, valid).verified).toBe(true)
    const clarification = evaluateSolidPlan(FOLD_PROBLEMS[5]!, { schemaVersion: PLAN_SCHEMA_VERSION, kind: "clarification", goal: "补充条件", factIds: [], questions: ["请补充折角或终态约束。"] })
    expect(clarification).toMatchObject({ verified: false, expectationMet: true })
    expect(summariseSolidEval([clarification])).toMatchObject({ verified: 0, expectedRejections: 0, expectedClarifications: 1 })
    expect(evaluateSolidPlan(problem, clarification.rawPlan).expectationMet).toBe(false)
  })

  it.each(FOLD_PROBLEMS)("compiles fold coverage $id according to its positive or rejection expectation", foldProblem => {
    const quad = { ...valid, actions: [{ ...face, inputs: { alias: "base", vertexNames: ["A", "B", "C", "D"], vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 9, y: 1.7, z: 0 }, { x: 7.5, y: 4.3, z: 0 }] } }] }
    const row = evaluateSolidPlan(foldProblem, quad)
    expect(row.expectationMet, JSON.stringify(row.diagnostics)).toBe(true)
    expect(row.verified).toBe(!foldProblem.expectedDiagnostic)
    if (foldProblem.expectedDiagnostic) expect(summariseSolidEval([row])).toMatchObject({ verified: 0, expectedRejections: 1 })
    expect(SOLID_PROBLEMS).toHaveLength(30)
  })

  it("checkpoints raw plans, responses and diagnostics, writes real JSON, and replays without network", async () => {
    const snapshots: SolidEvalReport[] = []
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response())
    const report = await runSolidEvaluation({ config, problems: [problem], sourceRevision: "revision", signal: new AbortController().signal,
      fetcher, save: async value => { snapshots.push(value) } })
    expect(snapshots[0]).toMatchObject({ status: "running", rows: [] })
    expect(snapshots.at(-1)).toMatchObject({ status: "completed", requests: 1, summary: { verified: 1 } })
    expect(report.rows[0]?.rawPlan).toEqual(valid)
    expect(report.rows[0]?.traces[0]?.response).toContain("choices")
    expect(report.rows[0]?.traces[0]?.events?.length).toBeGreaterThan(0)
    const filename = `test-results/solid-eval-tests/${crypto.randomUUID()}.json`
    await writeSolidReport(filename, report, [config.apiKey])
    const saved = await readSolidReport(filename)
    expect(JSON.stringify(saved)).not.toContain(config.apiKey)
    const replay = replaySolidReport(saved)
    expect(replay.summary.verified).toBe(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const changed = { ...report, rows: [{ ...report.rows[0]!, rawPlan: invalid, compiled: true, hasDraft: true, verification: "passed" }] }
    expect(replaySolidReport(changed).summary.verified).toBe(0)
    const recovered = { ...report, rows: [{ ...report.rows[0]!, failure: "old parser failure" }] }
    expect(replaySolidReport(recovered).rows[0]?.failure).toBeUndefined()
    const missing = { ...report, rows: [{ ...report.rows[0]!, rawPlan: undefined }] }
    expect(replaySolidReport(missing).rows[0]).toMatchObject({ compiled: false, verification: "not_run" })
    expect(replaySolidReport(missing).rows[0]?.checks).toBeUndefined()
  })

  it("continues after an individual transport failure and stops requests at the authorized cap", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("connection reset")).mockRejectedValueOnce(new Error("connection reset"))
      .mockRejectedValueOnce(new Error("connection reset")).mockImplementation(async () => response())
    const report = await runSolidEvaluation({ config: { ...config, maxRequests: 4 }, problems: [problem, { ...problem, id: "second" }, { ...problem, id: "third" }], sourceRevision: "test",
      signal: new AbortController().signal, fetcher, save: async () => {} })
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(report.rows).toHaveLength(3)
    expect(report.rows[0]?.failure).toContain("connection reset")
    expect(report.rows[1]?.verified).toBe(true)
    expect(report.rows[2]?.failure).toBeDefined()
    expect(report.requests).toBe(4)
  })

  it.each(["headers", "body"])("bounds hung %s and aborts the HTTP signal", async phase => {
    vi.useFakeTimers()
    let actualSignal: AbortSignal | null = null
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => {
      actualSignal = options!.signal as AbortSignal
      return phase === "headers" ? new Promise(() => {}) : Promise.resolve({ ok: true, text: () => new Promise(() => {}) } as unknown as Response)
    })
    const transport = createSolidEvalTransport(config, fetcher)
    const pending = transport.call(request, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(101)
    expect(await pending).toMatchObject({ ok: false, failure: "transport", message: "evaluation request timed out" })
    expect((actualSignal as AbortSignal | null)?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("honors cancellation and refuses subsequent requests before they reach fetch", async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}))
    const transport = createSolidEvalTransport(config, fetcher)
    const pending = transport.call(request, controller.signal)
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, failure: "cancelled" })
    expect(await transport.call(request, controller.signal)).toMatchObject({ ok: false, failure: "cancelled" })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
