import type { ModelEvent } from "@draw/agent-core"
import type { ModelClientStart } from "../../services/modelClient"

export interface SolidEvalConfig {
  apiKey: string
  model: string
  baseUrl: string
  maxRequests: number
  maxTokens: number
  timeoutMs: number
}

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer in ${minimum}..${maximum}`)
  return parsed
}

/** A credential alone never authorizes live evaluation. */
export function solidEvalConfig(env: Record<string, string | undefined>): SolidEvalConfig {
  if (env.MATHCANVAS_SOLID_EVAL_PAID !== "1") throw new Error("Live evaluation requires npm run eval:solid -- --allow-paid --max-requests N")
  const apiKey = env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required for live evaluation")
  const baseUrl = (env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/+$/, "")
  const url = new URL(baseUrl)
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid DEEPSEEK_BASE_URL")
  return {
    apiKey, baseUrl, model: env.DEEPSEEK_MODEL ?? "deepseek-chat",
    maxRequests: integer(env.DEEPSEEK_MAX_REQUESTS, 0, 1, 60, "DEEPSEEK_MAX_REQUESTS"),
    maxTokens: integer(env.DEEPSEEK_MAX_TOKENS, 4096, 1, 131072, "DEEPSEEK_MAX_TOKENS"),
    timeoutMs: integer(env.DEEPSEEK_TIMEOUT_MS, 60000, 100, 180000, "DEEPSEEK_TIMEOUT_MS")
  }
}

export interface SolidEvalRequest {
  messages: { role: string; content: string }[]
  tools: unknown[]
  outputMode?: string
  maxOutputTokens?: number
}
export interface SolidEvalTrace {
  request: SolidEvalRequest
  response?: unknown
  events?: ModelEvent[]
  failure?: string
}

class ProviderHttpError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`) }
}

/** The deadline covers headers AND body parsing, including fetch implementations ignoring abort. */
async function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const cancel = () => controller.abort(new Error("evaluation cancelled"))
  if (parent.aborted) cancel()
  else parent.addEventListener("abort", cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new Error("evaluation request timed out")), timeoutMs)
  let rejectAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason)
    if (controller.signal.aborted) rejectAbort()
    else controller.signal.addEventListener("abort", rejectAbort, { once: true })
  })
  try {
    if (controller.signal.aborted) throw controller.signal.reason
    return await Promise.race([work(controller.signal), aborted])
  } finally {
    clearTimeout(timer)
    parent.removeEventListener("abort", cancel)
    controller.signal.removeEventListener("abort", rejectAbort)
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function tokens(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function createSolidEvalTransport(config: SolidEvalConfig, fetcher: typeof fetch = fetch) {
  const usage = { requests: 0, inputTokens: 0, outputTokens: 0 }
  const traces: SolidEvalTrace[] = []
  return {
    usage, traces,
    async call(request: SolidEvalRequest, signal: AbortSignal): Promise<ModelClientStart> {
      if (signal.aborted) return { ok: false, failure: "cancelled", message: "evaluation cancelled", retryable: false }
      if (usage.requests >= config.maxRequests) return { ok: false, failure: "permission", message: "request cap reached", retryable: false }
      usage.requests += 1
      const trace: SolidEvalTrace = { request }
      traces.push(trace)
      const ids = { requestId: `eval-${usage.requests}`, attemptId: `eval-${usage.requests}` }
      try {
        const responseBody = await withDeadline(async abortSignal => {
          const response = await fetcher(`${config.baseUrl}/chat/completions`, {
            method: "POST", signal: abortSignal,
            headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
            body: JSON.stringify({
              model: config.model, messages: request.messages, stream: false,
              max_tokens: Math.min(config.maxTokens, request.maxOutputTokens ?? config.maxTokens),
              ...(request.tools.length > 0 ? { tools: request.tools, tool_choice: "auto" } : {}),
              ...(request.outputMode === "json_mode" ? { response_format: { type: "json_object" } } : {})
            })
          })
          const text = await response.text()
          trace.response = text
          if (!response.ok) throw new ProviderHttpError(response.status)
          return JSON.parse(text) as unknown
        }, signal, config.timeoutMs)
        const body = record(responseBody)
        const choices = body?.choices
        if (!Array.isArray(choices) || choices.length === 0) throw new Error("Invalid provider response: missing choices")
        const choice = record(choices[0]); const message = record(choice?.message)
        const measured = record(body?.usage)
        const inputTokens = tokens(measured?.prompt_tokens); const outputTokens = tokens(measured?.completion_tokens)
        usage.inputTokens += inputTokens ?? 0; usage.outputTokens += outputTokens ?? 0
        const events: ModelEvent[] = [{ ...ids, kind: "started", model: typeof body?.model === "string" ? body.model : config.model }]
        if (measured) events.push({ ...ids, kind: "usage", inputTokens, outputTokens })
        const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : []
        for (const [index, value] of calls.entries()) {
          const call = record(value); const fn = record(call?.function)
          let input: unknown = fn?.arguments ?? ""
          if (typeof input === "string") { try { input = JSON.parse(input) } catch { /* Let the real planner classify malformed arguments. */ } }
          events.push({ ...ids, kind: "tool_call", toolCallId: typeof call?.id === "string" ? call.id : `call-${index}`,
            toolId: typeof fn?.name === "string" ? fn.name : "unknown", input })
        }
        if (typeof message?.content === "string" && message.content.length > 0) events.push({ ...ids, kind: "delta", text: message.content })
        events.push({ ...ids, kind: "completed", ...(typeof choice?.finish_reason === "string" ? { stopReason: choice.finish_reason } : {}) })
        trace.events = events
        return { ok: true, events }
      } catch (error) {
        const detail = (error instanceof Error ? error.message : String(error)).replaceAll(config.apiKey, "[REDACTED]")
        trace.failure = detail
        const failure = signal.aborted ? "cancelled" : error instanceof ProviderHttpError
          ? [401, 403].includes(error.status) ? "auth" : error.status === 429 ? "rate_limited" : error.status >= 500 ? "server_error" : "unknown"
          : "transport"
        return { ok: false, failure, message: detail, retryable: ["transport", "rate_limited", "server_error"].includes(failure) }
      }
    }
  }
}
