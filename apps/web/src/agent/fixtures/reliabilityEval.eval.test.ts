import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import type { PlanEnvelope, PlannerPort, RunPhase } from "@draw/agent-core"
import { createBudget } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { createAgentRuntime } from "../agentRuntime"
import { createLocalPlanner } from "../localPlanner"
import { createModelPlanner } from "../modelPlanner"
import { writeSolidReport, readSolidReport } from "../../../../../scripts/solid-eval/report-files.mjs"

/**
 * **`eval:reliability`：完整协调器链路的评测入口**（T01，2026-10-26）。
 *
 * ## 它测的是哪条链
 *
 * 生产那一条：`createAgentRuntime` → 真实 `DraftStore`（含编译器/Worker 兜底）→
 * 真实协调器 → 隔离草稿 → **停在待确认**。**不自动确认**：`writeDocument` 在整轮里
 * 一次都不该被调用，这一点是每个用例的硬断言。
 *
 * ## 三种模式（互相排斥）
 *
 * - `local`（默认）：确定性本地规划器。**常规测试/离线冒烟**用它，不产生任何费用。
 * - `replay`：读 `MATHCANVAS_RELIABILITY_REPLAY` 里记录的**逐轮信封**，原样喂给同一条链。
 *   记录里没有的轮次**不会**被补出来 —— 需要多一轮就记 `infrastructure` 并标记未完成。
 * - `live`：真实 provider。必须有 `MATHCANVAS_RELIABILITY_LIVE=1` +
 *   `DEEPSEEK_API_KEY` + `MATHCANVAS_RELIABILITY_MAX_REQUESTS`；缺一样就**拒绝启动**。
 *
 * ## 分母与费用
 *
 * 本文件里的四条是 **dev-smoke**（开发冒烟），**不是**验收题单（T02 的 20/60 题）。
 * 费用一律记 `null`（`costKnown: false`）—— 这一轮没有任何计费证据，不许写成 0 元。
 *
 * 运行：`npm run eval:reliability -- --offline`（报告目录由 runner 选）。
 */

import { evaluateOracle, type Oracle, type OracleResult } from "./reliabilityOracle"

interface EvalCase {
  id: string
  prompt: string
  expected: "plan" | "clarification"
  /** `expected: "clarification"` 时，澄清正文必须包含的片段。 */
  contains?: string
  /** `expected: "plan"` 时，是否要求题设核验整体 `passed`（有题设的用例才要求）。 */
  requireVerification?: "passed"
  /** 这一条要交付什么（`draft` / `verification_passed` / `clarification`）。 */
  requiredOutputs?: readonly string[]
  /** 来源与复核状态：自生成题必须如实标 `unreviewed`。 */
  provenance?: { source: string; reviewStatus: string }
  /** **独立判据**：只读候选几何回代，不经过产品解析/核验。 */
  oracle?: Oracle
}

interface CaseFile {
  version: number
  suite: string
  notice?: string
  cases: readonly EvalCase[]
}

/** 题单由 runner 显式指定（缺省是 `test-fixtures/reliability/dev-smoke.json`）；不存在就拒绝跑。 */
async function loadCases(): Promise<readonly EvalCase[]> {
  const file = env.MATHCANVAS_RELIABILITY_CASES
  if (file === undefined || file.trim() === "") throw new Error("MATHCANVAS_RELIABILITY_CASES is required — use npm run eval:reliability")
  const parsed = (await readSolidReport(file)) as CaseFile
  if (parsed.version !== 1 || !Array.isArray(parsed.cases) || parsed.cases.length === 0) throw new Error(`invalid case file: ${file}`)
  for (const entry of parsed.cases) {
    if (typeof entry.id !== "string" || typeof entry.prompt !== "string" || (entry.expected !== "plan" && entry.expected !== "clarification")) {
      throw new Error(`invalid case entry in ${file}: ${JSON.stringify(entry).slice(0, 120)}`)
    }
  }
  return parsed.cases
}

type Mode = "local" | "replay" | "live"

interface ReliabilityCaseReport {
  id: string
  prompt: string
  expected: EvalCase["expected"]
  provenance: EvalCase["provenance"] | null
  requiredOutputs: readonly string[]
  mode: Mode
  revision: string
  terminal: RunPhase | "none" | "infrastructure"
  phase: "output_format" | "input_reading" | "identity_state" | "construction" | "solver" | "presentation_commit" | "infrastructure"
  passed: boolean
  draftPresent: boolean
  /** 独立判据（只读候选几何回代）；没有 oracle 的条目为 `not_applicable`。 */
  independent: OracleResult
  verificationStatus: string | null
  verificationChecks: { kind: string; status: string; sourceText: string }[]
  questions: string[] | null
  /** 整轮运行里 `writeDocument` 的调用次数（**必须为 0**：不自动确认用户文档）。 */
  liveWrites: number
  primitivesAfter: number
  requests: number
  costUsd: null
  costKnown: false
  elapsedMs: number
  error: string | null
  /** 这一轮真实发生的规划轮次（replay 用它复现；缺一轮就标未完成）。 */
  rounds: PlanEnvelope[]
}

/** 应用侧刻意不装 `@types/node`（同 solid eval）：这里只需要 `env`。 */
declare const process: { env: Record<string, string | undefined> }

const env = process.env
const MODE: Mode = env.MATHCANVAS_RELIABILITY_LIVE === "1" ? "live" : env.MATHCANVAS_RELIABILITY_REPLAY ? "replay" : "local"
const REPORT_DIR = env.MATHCANVAS_RELIABILITY_REPORT
const REVISION = env.MATHCANVAS_RELIABILITY_REVISION ?? "unknown"
const LIVE_MAX_REQUESTS = Number(env.MATHCANVAS_RELIABILITY_MAX_REQUESTS ?? "")

function assertModeConfigured(): void {
  if (REPORT_DIR === undefined || REPORT_DIR.trim() === "") throw new Error("Use npm run eval:reliability — it selects a unique report directory")
  if (MODE !== "live") return
  if (!env.DEEPSEEK_API_KEY?.trim()) throw new Error("live mode requires DEEPSEEK_API_KEY (ordinary tests never take this path)")
  if (!Number.isInteger(LIVE_MAX_REQUESTS) || LIVE_MAX_REQUESTS < 1) throw new Error("live mode requires MATHCANVAS_RELIABILITY_MAX_REQUESTS >= 1")
}

function replayRounds(): Promise<Record<string, PlanEnvelope[]>> {
  if (env.MATHCANVAS_RELIABILITY_REPLAY === undefined) return Promise.resolve({})
  return readSolidReport(env.MATHCANVAS_RELIABILITY_REPLAY).then((value: unknown) => {
    const parsed = value as { cases?: Record<string, { rounds?: PlanEnvelope[] }> }
    return Object.fromEntries(Object.entries(parsed.cases ?? {}).map(([id, entry]) => [id, entry.rounds ?? []]))
  })
}

function replayPlanner(rounds: readonly PlanEnvelope[]): PlannerPort {
  let index = 0
  return {
    async plan() {
      const envelope = rounds[index]
      if (envelope === undefined) throw new Error(`REPLAY_EXHAUSTED: recorded rounds = ${rounds.length}`)
      index += 1
      return { plan: envelope, requestId: `replay-${index}`, attemptId: `replay-${index}` }
    }
  }
}

function countingPlanner(inner: PlannerPort): { planner: PlannerPort; requests: () => number; rounds: PlanEnvelope[] } {
  let requests = 0
  const rounds: PlanEnvelope[] = []
  return {
    planner: {
      async plan(request) {
        requests += 1
        const outcome = await inner.plan(request)
        if ("plan" in outcome) rounds.push(outcome.plan)
        return outcome
      }
    },
    requests: () => requests,
    rounds
  }
}

function plannerFor(entry: EvalCase, recorded: Record<string, PlanEnvelope[]>): { planner: PlannerPort; requests: () => number; rounds: PlanEnvelope[]; notRun: string | null } {
  if (MODE === "replay") {
    const rounds = recorded[entry.id]
    if (rounds === undefined || rounds.length === 0) return { planner: replayPlanner([]), requests: () => 0, rounds: [], notRun: `replay has no recorded rounds for ${entry.id}` }
    const wrapped = countingPlanner(replayPlanner(rounds))
    return { ...wrapped, notRun: null }
  }
  const base = MODE === "live" ? createModelPlanner() : createLocalPlanner()
  const wrapped = countingPlanner(base)
  return { ...wrapped, notRun: null }
}

function runContext(document: GeometryDocument, runId: string) {
  return {
    runId,
    conversationId: `reliability-${runId}`,
    promptMessageId: `prompt-${runId}`,
    target: {
      projectId: "project-reliability",
      documentId: document.metadata.id,
      workspace: document.workspace as "conics" | "geometry3d",
      epoch: `epoch:${document.metadata.id}`,
      generation: document.revision,
      contentHash: contentFingerprint(document)
    },
    sources: [],
    textProfileId: "local-planner",
    capabilityRevision: "2026-10-26.reliability",
    policyRevision: "local"
  }
}

function exportPreflight() {
  return {
    preflight: () => ({
      format: "svg" as const,
      supported: true,
      requiresUserAcceptance: false,
      omitted: [],
      fontLoss: [],
      approximationNotes: [],
      blockedReasons: [],
      projectedEntityCount: 0
    })
  }
}

function runtimeFor(planner: PlannerPort, runId: string, budget?: ReturnType<typeof createBudget>) {
  let current = createEmptyDocument("geometry3d")
  const written: GeometryDocument[] = []
  const stages: { ok: boolean; verification?: { status: string; checks: readonly { kind: string; status: string; sourceText: string }[] } }[] = []
  const runtime = createAgentRuntime({
    ...(budget === undefined ? {} : { budget }),
    readDocument: () => current,
    writeDocument: (candidate) => {
      written.push(candidate)
      current = candidate
    },
    readSceneDocuments: () => [{
      handle: {
        projectId: "project-reliability",
        documentId: current.metadata.id,
        workspace: current.workspace as "geometry3d",
        epoch: `epoch:${current.metadata.id}`,
        generation: current.revision,
        contentHash: contentFingerprint(current)
      },
      document: current
    }],
    planner,
    exportPreflight: exportPreflight(),
    onStageOutcome: (outcome) => stages.push(outcome as never),
    projectId: "project-reliability",
    runId,
    now: () => 1_000
  })
  return { runtime, written, stages, current: () => current }
}

function phaseOf(entry: EvalCase, terminal: ReliabilityCaseReport["terminal"], passed: boolean, verificationStatus: string | null, error: string | null): ReliabilityCaseReport["phase"] {
  if (error !== null || terminal === "infrastructure") return "infrastructure"
  if (entry.expected === "clarification") return "input_reading"
  if (passed) return "presentation_commit"
  if (terminal === "failed" && verificationStatus === "failed") return "construction"
  if (terminal === "failed") return "output_format"
  return "infrastructure"
}

describe("完整的协调器链路评测（T01）", () => {
  assertModeConfigured()

  it("每条用例都在干净文档 / 干净会话上跑到终态，且从不自动确认", async () => {
    const cases = await loadCases()
    const recorded = await replayRounds()
    const reports: ReliabilityCaseReport[] = []
    const notRun: string[] = []

    for (const entry of cases) {
      const { planner, requests, rounds, notRun: missing } = plannerFor(entry, recorded)
      if (missing !== null) {
        notRun.push(missing)
        continue
      }
      const started = Date.now()
      const { runtime, written, stages, current } = runtimeFor(planner, entry.id)
      const events: RunPhase[] = []
      let terminal: ReliabilityCaseReport["terminal"]
      let error: string | null = null
      try {
        for await (const event of runtime.coordinator.start({ run: runContext(current(), entry.id), userMessage: entry.prompt })) events.push(event.phase)
        terminal = events.at(-1) ?? "none"
      } catch (caught) {
        terminal = "infrastructure"
        error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught)
      }

      const stage = stages.at(-1)
      const verification = stage?.ok === true ? stage.verification : undefined
      const questions = runtime.questions() ?? null
      const draftPresent = terminal === "awaiting_confirmation" && stage?.ok === true
      const draftId = runtime.draftId()
      const candidate = draftId === null ? null : runtime.drafts.getPreview(draftId)?.candidate ?? null
      const independent: OracleResult = entry.oracle === undefined
        ? { status: "not_applicable", facts: [] }
        : evaluateOracle(candidate, entry.oracle)
      const requiredOutputs = entry.requiredOutputs ?? []
      const outputsSatisfied = requiredOutputs.every((output) =>
        output === "draft" ? draftPresent
          : output === "verification_passed" ? verification?.status === "passed"
            : output === "clarification" ? terminal === "waiting" && questions !== null && questions.length > 0
              : false
      )
      const passed = entry.expected === "plan"
        ? draftPresent && (entry.requireVerification === undefined || verification?.status === entry.requireVerification) && outputsSatisfied
          && (independent.status === "passed" || independent.status === "not_applicable")
        : terminal === "waiting" && questions !== null && questions.join(" ").includes(entry.contains ?? "") && outputsSatisfied
          && (independent.status === "passed" || independent.status === "not_applicable")

      const report: ReliabilityCaseReport = {
        id: entry.id,
        prompt: entry.prompt,
        expected: entry.expected,
        provenance: entry.provenance ?? null,
        requiredOutputs,
        mode: MODE,
        revision: REVISION,
        terminal,
        phase: phaseOf(entry, terminal, passed, verification?.status ?? null, error),
        passed,
        draftPresent,
        independent,
        verificationStatus: verification?.status ?? null,
        verificationChecks: (verification?.checks ?? []).map((check) => ({ kind: check.kind, status: check.status, sourceText: check.sourceText })),
        questions,
        liveWrites: written.length,
        primitivesAfter: current().primitives.length,
        requests: requests(),
        costUsd: null,
        costKnown: false,
        elapsedMs: Date.now() - started,
        error,
        rounds
      }
      await writeSolidReport(`${REPORT_DIR}/case-${entry.id}.json`, report, [env.DEEPSEEK_API_KEY ?? ""])
      reports.push(report)
    }

    const summary = {
      mode: MODE,
      revision: REVISION,
      startedAt: new Date().toISOString(),
      cases: reports.map((report) => ({ id: report.id, expected: report.expected, terminal: report.terminal, phase: report.phase, passed: report.passed, independent: report.independent.status, requests: report.requests, elapsedMs: report.elapsedMs })),
      totals: { cases: cases.length, ran: reports.length, passed: reports.filter((report) => report.passed).length, incomplete: notRun.length },
      notRun,
      requests: reports.reduce((total, report) => total + report.requests, 0),
      costUsd: null,
      costKnown: false,
      notes: [
        "dev-smoke 题单，不是 T02 的验收题单；分母只是这几条。",
        "费用未知：本轮没有计费证据，不把 costUsd 写成 0。",
        "不自动确认：每条用例的 liveWrites 必须为 0。",
        "独立判据：有 oracle 的条目只读候选几何回代，不经过产品解析器/核验器。"
      ]
    }
    await writeSolidReport(`${REPORT_DIR}/summary.json`, summary, [env.DEEPSEEK_API_KEY ?? ""])
    await writeSolidReport(`${REPORT_DIR}/replay.json`, {
      mode: MODE,
      cases: Object.fromEntries(reports.map((report) => [report.id, { prompt: report.prompt, rounds: report.rounds }]))
    }, [env.DEEPSEEK_API_KEY ?? ""])

    // 硬断言：没有"未执行"的用例；每条都跑过、都没有写用户文档。
    expect(notRun, notRun.join("；")).toEqual([])
    expect(reports.every((report) => report.liveWrites === 0), JSON.stringify(reports.filter((report) => report.liveWrites !== 0))).toBe(true)
    // 每条用例的期望终态都要成立（passed 在报告里逐条可查）。
    expect(reports.map((report) => [report.id, report.passed, report.terminal, report.phase, report.error])).toEqual(
      cases.map((entry) => [entry.id, true, entry.expected === "plan" ? "awaiting_confirmation" : "waiting", entry.expected === "plan" ? "presentation_commit" : "input_reading", null])
    )
    // **独立判据**：有 oracle 的条目必须由独立回代通过；没有的必须是 not_applicable（不许假装验证过）。
    for (const report of reports) {
      const entry = cases.find((candidateEntry) => candidateEntry.id === report.id)!
      expect(report.independent.status, `${report.id}：${JSON.stringify(report.independent.facts.filter((fact) => fact.status === "failed"))}`).toBe(entry.oracle === undefined ? "not_applicable" : "passed")
    }
    // 费用未知就是未知。
    expect(reports.every((report) => report.costUsd === null && report.costKnown === false)).toBe(true)
  }, 300_000)

  /**
   * **取消**（T01 要求：取消后及时收尾、且不写现场文档）。
   *
   * 用一个"进门后挂住"的规划器把取消点钉在**规划返回之后**：协调器在 `plan()` 之后有
   * `if (cancelled) return`，所以迟到的计划不会被暂存、更不会被提交。
   */
  it("取消：迟到的规划器不会写用户文档", async () => {
    let releasePlanner!: () => void
    const gate = new Promise<void>((resolve) => { releasePlanner = resolve })
    let plannerEntered!: () => void
    const entered = new Promise<void>((resolve) => { plannerEntered = resolve })
    const planner: PlannerPort = {
      async plan() {
        plannerEntered()
        await gate
        return { plan: cubeEnvelope(), requestId: "cancel-1", attemptId: "cancel-1" }
      }
    }
    const { runtime, written, current } = runtimeFor(planner, "reliability-cancel")
    const events: RunPhase[] = []
    const consuming = (async () => {
      for await (const event of runtime.coordinator.start({ run: runContext(current(), "reliability-cancel"), userMessage: "建一个棱长 3 的立方体" })) events.push(event.phase)
    })()
    await entered
    const cancelResult = runtime.coordinator.cancel("user")
    releasePlanner()
    await consuming

    expect(cancelResult.cancelled).toBe(true)
    expect(runtime.coordinator.phase()).toBe("cancelled")
    expect(written).toHaveLength(0)
    expect(current().primitives).toHaveLength(0)
    expect(events).not.toContain("awaiting_confirmation")
    await writeSolidReport(`${REPORT_DIR}/mechanism-cancel.json`, {
      id: "cancel", mode: MODE, revision: REVISION, phase: "infrastructure",
      cancelAccepted: cancelResult.cancelled, terminal: runtime.coordinator.phase(),
      liveWrites: written.length, events, costUsd: null, costKnown: false
    }, [env.DEEPSEEK_API_KEY ?? ""])
  }, 60_000)

  /**
   * **预算中断**（T01 要求：修复共用总预算；被拒即停、不改文档）。
   *
   * 第一份计划是一笔**退化棱柱**（编译期拒绝并给修复请求）；`generation` 上限给 1，
   * 于是"再问一次修一修"这一步被预算拒绝 —— 终态必须是 `failed`，规划器**只被问了一次**。
   */
  it("预算耗尽：修复轮被总预算拒绝，不写用户文档", async () => {
    let calls = 0
    const planner: PlannerPort = {
      async plan() {
        calls += 1
        if (calls > 1) throw new Error("budget should have stopped the run before a second plan call")
        return { plan: degeneratePrismEnvelope(), requestId: "budget-1", attemptId: "budget-1" }
      }
    }
    const { runtime, written, current } = runtimeFor(planner, "reliability-budget", createBudget({ generation: 1 }))
    const events: RunPhase[] = []
    for await (const event of runtime.coordinator.start({ run: runContext(current(), "reliability-budget"), userMessage: "画一个棱柱" })) events.push(event.phase)

    expect(events.at(-1)).toBe("failed")
    expect(runtime.coordinator.phase()).toBe("failed")
    expect(calls).toBe(1)
    expect(written).toHaveLength(0)
    const ledger = [...runtime.coordinator.ledger()]
    const last = ledger.at(-1)
    expect(JSON.stringify(last)).toMatch(/budget|额度/)
    await writeSolidReport(`${REPORT_DIR}/mechanism-budget.json`, {
      id: "budget", mode: MODE, revision: REVISION, phase: "infrastructure",
      terminal: runtime.coordinator.phase(), plannerCalls: calls, liveWrites: written.length, events,
      ledgerTail: last === undefined ? null : { phase: last.phase, detail: last.detail },
      costUsd: null, costKnown: false
    }, [env.DEEPSEEK_API_KEY ?? ""])
  }, 60_000)
})

function cubeEnvelope(): PlanEnvelope {
  return {
    schemaVersion: "mathcanvas.plan.v1",
    kind: "plan",
    goal: "建一个棱长 2 的立方体",
    factIds: [],
    actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } }]
  }
}

function degeneratePrismEnvelope(): PlanEnvelope {
  return {
    schemaVersion: "mathcanvas.plan.v1",
    kind: "plan",
    goal: "退化棱柱（拉伸向量为零）",
    factIds: [],
    actions: [{
      actionId: "solid.create_prism",
      actionKey: "d",
      factIds: [],
      inputs: {
        alias: "d",
        basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }],
        vector: { x: 0, y: 0, z: 0 }
      }
    }]
  }
}
