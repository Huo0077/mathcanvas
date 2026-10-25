import { createEmptyDocument } from "@draw/dsl"
import {
  DRAFT_ACTION_IDS,
  createBudget,
  compilePlan,
  parsePlanEnvelope,
  type ModelEvent,
  type PlanRequest,
  type ToolDescriptor
} from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { createModelPlanner, type ModelPlannerProvider } from "../modelPlanner"

/** 评测跑在 Node 里（vitest）；web 的 tsconfig 不带 node 类型，所以这里只声明用到的那一小块。 */
declare const process: { env: Record<string, string | undefined> }
import { SOLID_PROBLEMS } from "./examSolid30.problems"

/**
 * **30 道立体几何题的**真实模型评测（2026-10-25）。
 *
 * ## 它测什么
 *
 * 用**产品自己的规划器**（`createModelPlanner`：同一份系统提示词、同一条通道选择、同一套
 * 信封校验），把 30 道题交给真实模型；拿回来的计划再走**产品自己的编译与核验**
 *（`compilePlan`：动作编译 + 题设逐条核验）。
 *
 * ## 它与产品路径的差别（必须写清）
 *
 * - **传输层被替换**：产品的传输是 Rust 侧 `provider_run`（借系统凭据库、SSE 归一化、
 *   取消、重试）；这里直接 `fetch` 非流式，然后把响应**归一成同一套 `ModelEvent`**。
 *   所以读数里"传输失败"这一类不具有产品路径的代表性。
 * - **不做协调器修复**：每题只问一次；产品会给一次格式修复。这里的通过率是**首轮**读数。
 *
 * ## 怎么跑
 *
 * ```powershell
 * $env:DEEPSEEK_API_KEY = "sk-..."     # 由你自己导出，不要写进仓库
 * $env:DEEPSEEK_MODEL   = "deepseek-chat"   # 可选，默认 deepseek-chat
 * npx vitest run apps/web/src/agent/fixtures/examSolid30.eval.test.ts
 * ```
 *
 * 没有 `DEEPSEEK_API_KEY` 时整组跳过（不会静默算 0 分）。
 * 报告写在 `test-results/solid30-report.json`（生成目录，不进源码）。
 */
const API_KEY = process.env.DEEPSEEK_API_KEY
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat"
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1"
const MAX_REQUESTS = Number(process.env.DEEPSEEK_MAX_REQUESTS ?? 60)

const provider: ModelPlannerProvider = {
  id: "deepseek-eval",
  modelId: MODEL,
  dialect: "deepseek",
  revision: 1,
  // 存储里的健康记录显示这家 `tools` 已验过：走原生工具通道（与产品路径一致）。
  capabilities: { tools: "verified", json: "unknown", vision: "unknown" }
}

const planTool: ToolDescriptor = { id: "plan.set_plan", kind: "control", effect: "propose_plan", description: "提交本轮的构图计划（动作序列），只产生隔离草稿", phases: ["planning"], workspaces: [] }

let requests = 0
let inputTokens = 0
let outputTokens = 0

type Usage = { prompt_tokens?: number; completion_tokens?: number }

function ids(): { requestId: string; attemptId: string } {
  return { requestId: `eval-${requests}`, attemptId: `eval-${requests}` }
}

function failureFor(status: number): string {
  if (status === 401 || status === 403) return "auth"
  if (status === 429) return "rate_limited"
  if (status >= 500) return "server_error"
  return "unknown"
}

/** 发一次真实请求，把响应归一成产品认的 `ModelEvent[]`。 */
async function callDeepSeek(request: { messages: { role: string; content: string }[]; tools: unknown[]; outputMode?: string }) {
  if (requests >= MAX_REQUESTS) {
    return { ok: false as const, failure: "permission", message: `request cap reached (${MAX_REQUESTS})`, retryable: false }
  }
  requests += 1
  const body: Record<string, unknown> = {
    model: MODEL,
    messages: request.messages.map(({ role, content }) => ({ role, content })),
    stream: false,
    // 输出上限：题面复杂时 2048 会把计划截断（首轮 4/30 就是 length）。这里按"任务需要"给 4096。
    max_tokens: Number(process.env.DEEPSEEK_MAX_TOKENS ?? 4096)
  }
  if (request.tools.length > 0) {
    body.tools = request.tools
    body.tool_choice = "auto"
  }
  if (request.outputMode === "json_mode") body.response_format = { type: "json_object" }

  let response: Response
  try {
    response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(body)
    })
  } catch (error) {
    return { ok: false as const, failure: "transport", message: error instanceof Error ? error.message : String(error), retryable: true }
  }
  if (!response.ok) {
    return { ok: false as const, failure: failureFor(response.status), message: `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`, retryable: response.status === 429 || response.status >= 500 }
  }

  // 读响应体也可能中途被重置（ECONNRESET）；那属于传输失败，不能把整轮评测炸掉。
  let data: any
  try {
    data = await response.json()
  } catch (error) {
    return { ok: false as const, failure: "transport", message: error instanceof Error ? error.message : String(error), retryable: true }
  }
  const parsedData = data as {
    model?: string
    choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[]
    usage?: Usage
  }
  const parsedBody = parsedData
  const usage = parsedBody.usage
  inputTokens += usage?.prompt_tokens ?? 0
  outputTokens += usage?.completion_tokens ?? 0
  const events: ModelEvent[] = [{ ...ids(), kind: "started", model: parsedBody.model ?? MODEL }]
  if (usage) events.push({ ...ids(), kind: "usage", inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens })
  const choice = parsedBody.choices?.[0]
  const toolCalls = choice?.message?.tool_calls ?? []
  for (const [index, call] of toolCalls.entries()) {
    let input: unknown = call.function?.arguments ?? ""
    if (typeof input === "string") {
      try { input = JSON.parse(input) } catch { /* 保留原文，让信封校验如实报错 */ }
    }
    events.push({ ...ids(), kind: "tool_call", toolCallId: call.id ?? `call-${requests}-${index}`, toolId: call.function?.name ?? "unknown", input })
  }
  if (toolCalls.length === 0 && typeof choice?.message?.content === "string" && choice.message.content.length > 0) {
    events.push({ ...ids(), kind: "delta", text: choice.message.content })
  }
  events.push({ ...ids(), kind: "completed", stopReason: choice?.finish_reason })
  return { ok: true as const, events }
}

function requestFor(prompt: string, id: string): PlanRequest {
  return {
    run: {
      runId: `solid30-${id}`,
      conversationId: `solid30-${id}`,
      promptMessageId: `msg-${id}`,
      target: { projectId: "local", documentId: `doc-${id}`, workspace: "geometry3d", epoch: `epoch-${id}`, generation: 1, contentHash: "hash" },
      sources: [],
      textProfileId: "deepseek-eval",
      capabilityRevision: "eval",
      policyRevision: "local"
    },
    // 题面本身是"求值"型问句，模型会直接给答案；这里明确要求**作图**（产品里"作图题"的用法）。
    userMessage: `请根据下面的题面画出示意图（只作图，不必求解，也不要给数值答案）：${prompt}`,
    budget: createBudget(),
    signal: new AbortController().signal,
    model: {
      context: {
        preamble: "你是 MathCanvas 的构图助手。",
        handles: { target: { projectId: "local", documentId: `doc-${id}`, workspace: "geometry3d", epoch: `epoch-${id}`, generation: 1, contentHash: "hash" }, sources: [] },
        binding: { conversationId: `solid30-${id}`, projectId: "local", documentId: `doc-${id}`, generation: 1 },
        workspace: "geometry3d",
        facts: [],
        derived: [],
        selectedRefs: [],
        skills: [],
        // 计划工具 schema 的动作枚举来自这里：空数组 ⇒ 模型一个动作都发不出来（只会回答文字）。
        availableActions: [...DRAFT_ACTION_IDS],
        warnings: [],
        estimatedCharacters: 128
      },
      tools: [planTool]
    },
    conversation: {
      binding: { conversationId: `solid30-${id}`, projectId: "local", documentId: `doc-${id}`, workspace: "geometry3d", generation: 1 },
      summary: "",
      facts: [],
      messages: [{ id: "m0", role: "user", text: prompt, createdAt: 1 }],
      observation: { facts: [], summary: "空场景" },
      warnings: [],
      estimatedCharacters: 128
    }
  }
}

describe.skipIf(!API_KEY)(`30 道立体几何 · 真实模型（${MODEL}）`, () => {
  it("runs all 30 and writes a report", async () => {
    const planner = createModelPlanner({
      resolveProvider: async () => ({ ok: true, provider }),
      runModel: async (request) => callDeepSeek(request)
    })

    const rows: {
      id: string
      focus: string
      kind: string
      actions: number
      failure?: string
      compiled: boolean
      verification: string
      reason?: string
    }[] = []

    for (const problem of SOLID_PROBLEMS) {
      const outcome = await planner.plan(requestFor(problem.prompt, problem.id))
      if ("failure" in outcome) {
        rows.push({ id: problem.id, focus: problem.focus, kind: "-", actions: 0, failure: `${outcome.failure.category}: ${outcome.failure.detail.slice(0, 120)}`, compiled: false, verification: "not_run" })
        continue
      }
      const parsed = parsePlanEnvelope(outcome.plan)
      if (!parsed.ok) {
        rows.push({ id: problem.id, focus: problem.focus, kind: "invalid", actions: 0, compiled: false, verification: "not_run", reason: parsed.errors[0] ? `${parsed.errors[0].code}@${parsed.errors[0].path}` : "envelope" })
        continue
      }
      /** **只有 `kind: "plan"` 才是"作图计划"**；`answer`/`clarification` 不是图，不能算"编译通过"。 */
      if (parsed.value.kind !== "plan") {
        rows.push({ id: problem.id, focus: problem.focus, kind: parsed.value.kind, actions: 0, compiled: false, verification: "not_a_plan" })
        continue
      }
      const compiled = compilePlan(parsed.value, { document: createEmptyDocument("geometry3d"), prompt: problem.prompt, conversationId: `solid30-${problem.id}`, documentGeneration: 0 })
      rows.push({
        id: problem.id,
        focus: problem.focus,
        kind: "plan",
        actions: parsed.value.actions.length,
        compiled: compiled.ok,
        verification: compiled.diagramVerification?.status ?? "none",
        reason: compiled.ok ? undefined : compiled.diagnostics[0]?.code
      })
    }

    const asPlan = rows.filter((row) => row.kind === "plan").length
    const answered = rows.filter((row) => row.kind === "answer" || row.kind === "clarification").length
    const compiled = rows.filter((row) => row.compiled).length
    const verified = rows.filter((row) => row.verification === "passed").length
    const report = {
      model: MODEL,
      at: new Date().toISOString(),
      problems: SOLID_PROBLEMS.length,
      requests,
      inputTokens,
      outputTokens,
      asPlan,
      answered,
      compiled,
      verified,
      rows
    }

    console.log(`\n===== 30 题真实模型读数 =====
模型 ${MODEL}；请求 ${requests}；tokens in/out ${inputTokens}/${outputTokens}
输出计划 ${asPlan}/30；只给了答案/澄清 ${answered}/30；计划编译通过 ${compiled}/30；**整题核验通过 ${verified}/30**
${rows.map((row) => `${row.id} ${row.focus} kind=${row.kind} actions=${row.actions} compile=${row.compiled ? "y" : `n(${row.reason ?? row.failure ?? "?"})`} verify=${row.verification}`).join("\n")}\n\nREPORT_JSON ${JSON.stringify(report)}`)
    expect(requests).toBeLessThanOrEqual(MAX_REQUESTS)
  }, 900_000)
})
