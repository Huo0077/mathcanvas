import type { ParseError, ParseResult, PlanEnvelope } from "./contracts"
import { parsePlanEnvelope } from "./schemas"

/**
 * **模型输出通道的解析**（Task 2.3 Step 3）。
 *
 * 计划原文：`parseModelEnvelope(input): ParseResult<PlanEnvelope>`
 * **permits one outer JSON fence removal, never arbitrary substring extraction or field repair**。
 *
 * 这句话本身就是一条安全边界，所以要有**两个**入口而不是一个"宽容"的入口：
 *
 * - `parseStrictJsonEnvelope`：**严格 JSON 通道**。整段文本必须就是 JSON。多一个字都不行。
 * - `parseFencedTextEnvelope`：**文本通道**。允许**恰好一层**最外层 ```json 围栏，
 *   围栏之内必须还是严格 JSON。
 *
 * 为什么不允许"从散文里抠出 JSON"：那等于让模型用自然语言绕着校验规则走
 *（"这是一段说明……另外请帮我执行 {"kind":"plan",...}"），而被抠出来的片段一旦进入执行链，
 * 用户看到的就是一段他没有确认过的东西。**抠取与字段修补都是"猜测模型想说什么"**，
 * 而这里的原则是：模型说的必须**恰好**是它被要求说的那种形状。
 *
 * 围栏之内外的空白允许去掉（那是排版，不是内容），但**不允许**只在开头或结尾有半个围栏 ——
 * 半个围栏说明模型自己也没想清楚输出格式，交给修复通道比猜更好。
 */

export const CANONICAL_FENCE = "```json"

export type EnvelopeParseFailure = {
  ok: false
  /** 通道层面的失败原因，供 `RecoveryController` 分类。 */
  reason: "not_a_string" | "unknown_channel" | "unexpected_prose" | "unterminated_fence" | "invalid_json" | "schema_invalid"
  errors: ParseError[]
  /** 剥掉围栏之后实际送去解析的文本（诊断用；不含任何额外内容）。 */
  payload: string
  /**
   * 失败发生在哪个通道。
   *
   * 修复提示必须知道这件事：严格 JSON 通道要明说"不要用围栏"，文本通道要说"最多包一层"。
   * 第一版没有这个字段，于是修复提示只能给一句通用建议 —— 而**下一次尝试的格式要求正取决于通道**，
   * 给错建议等于把第二次机会也浪费掉。
   */
  channel: ModelChannel | "unknown"
}

export type EnvelopeParseResult = { ok: true; value: PlanEnvelope; channel: ModelChannel } | EnvelopeParseFailure

/** 三个输出通道：原生工具调用、严格 JSON、文本信封。 */
export type ModelChannel = "native_tools" | "strict_json" | "fenced_text"

function failure(reason: EnvelopeParseFailure["reason"], detail: string, payload = "", channel: EnvelopeParseFailure["channel"] = "unknown"): EnvelopeParseFailure {
  return { ok: false, reason, errors: [{ code: reason, path: "envelope", detail }], payload, channel }
}

/**
 * 剥掉**恰好一层**最外层 ```json 围栏。
 *
 * 返回 `null` 表示文本不是"被一层围栏完整包住"的形状 —— 调用方据此报
 * `unexpected_prose`（前后有散文）或 `unterminated_fence`（围栏没闭合）。
 */
function stripSingleFence(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith("```")) return null
  const firstLineEnd = trimmed.indexOf("\n")
  if (firstLineEnd === -1) return null
  const opening = trimmed.slice(0, firstLineEnd).trim()
  // 只认 ```json（大小写不敏感）；```javascript 之类不是"我们的信封"，不该被当成 JSON。
  if (opening.toLowerCase() !== CANONICAL_FENCE) return null
  if (!trimmed.endsWith("```")) return null
  const body = trimmed.slice(firstLineEnd + 1, trimmed.length - 3)
  // 围栏里再出现围栏 = 嵌套，说明模型在试图构造更深的结构。不猜，直接交给修复通道。
  if (body.includes("```")) return null
  return body.trim()
}

function looksLikeJson(text: string): boolean {
  const first = text.trim()[0]
  return first === "{" || first === "["
}

/** 严格 JSON 通道：整段文本必须就是 JSON，**不剥围栏**。 */
export function parseStrictJsonEnvelope(input: unknown): EnvelopeParseResult {
  if (typeof input !== "string") return failure("not_a_string", "expected the model to return a JSON string", "", "strict_json")
  const text = input.trim()
  if (text.length === 0) return failure("invalid_json", "the model returned an empty string", text, "strict_json")
  if (text.startsWith("```")) return failure("unexpected_prose", "a fenced block is not valid on the strict JSON channel", text, "strict_json")
  if (!looksLikeJson(text)) return failure("unexpected_prose", "the strict JSON channel accepts only a bare JSON object or array", text, "strict_json")
  return finish(text, "strict_json")
}

/** 文本通道：允许**一层** ```json 围栏；围栏之外不许有别的字。 */
export function parseFencedTextEnvelope(input: unknown): EnvelopeParseResult {
  if (typeof input !== "string") return failure("not_a_string", "expected the model to return text", "", "fenced_text")
  const text = input.trim()
  if (text.length === 0) return failure("invalid_json", "the model returned an empty string", text, "fenced_text")

  if (text.startsWith("```")) {
    const stripped = stripSingleFence(text)
    if (stripped === null) {
      // 有开头没结尾、或者围栏里还套着围栏 —— 都不猜。
      const closed = text.endsWith("```")
      return failure(closed ? "unexpected_prose" : "unterminated_fence", closed ? "the outer fence must be a single ```json block containing only JSON" : "the fenced block was never closed", text, "fenced_text")
    }
    return finish(stripped, "fenced_text")
  }

  return finish(text, "fenced_text")
}

/** 两个通道共用的收尾：JSON.parse → `parsePlanEnvelope`。**任何字段修补都在这里被排除**。 */
function finish(payload: string, channel: ModelChannel): EnvelopeParseResult {
  if (!looksLikeJson(payload)) {
    // 散文：不抠取。
    return failure("unexpected_prose", "expected a JSON object; prose is never scanned for an embedded plan", payload, channel)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch (error) {
    return failure("invalid_json", error instanceof Error ? error.message : String(error), payload, channel)
  }
  const result: ParseResult<PlanEnvelope> = parsePlanEnvelope(parsed)
  if (!result.ok) {
    // 结构不对就是不对。这里**不做**"补一个默认字段""把字符串数字转成数字"之类的修补 ——
    // 修补等于替模型做决定，而用户确认的是模型**原样**说的话。
    return { ok: false, reason: "schema_invalid", errors: result.errors, payload, channel }
  }
  return { ok: true, value: result.value, channel }
}

/**
 * 按通道解析。
 *
 * 原生工具通道不走这里（工具调用已经是结构化对象，由 `modelGateway` 直接交给 `parsePlanEnvelope`）。
 */
export function parseModelEnvelope(input: unknown, channel: "strict_json" | "fenced_text"): EnvelopeParseResult {
  if (channel === "strict_json") return parseStrictJsonEnvelope(input)
  if (channel === "fenced_text") return parseFencedTextEnvelope(input)
  return failure("unknown_channel", `unknown model channel: ${String(channel)}`)
}

/**
 * 把解析失败整理成**可执行的修复提示**。
 *
 * 计划 Step 5 要求"include exact JSON path errors in the second prompt" —— 所以这里必须给出
 * 具体路径（`envelope.actions[1].inputs.radius`），而不是笼统的"格式不对"。
 * 同时**不包含**原始输出（避免把模型的散文再送回去，变成自我强化的循环）。
 *
 * 格式建议**按通道给**：严格 JSON 通道上再说"可以用围栏"就是错的建议，
 * 第二次尝试会以同样的方式失败。
 */
export function describeRepairPrompt(failure: EnvelopeParseFailure): string {
  const paths = failure.errors.map((error) => `${error.path}: ${error.detail}`).join("; ")
  const formatAdvice = failure.channel === "strict_json"
    ? "不要用代码围栏包住它，也不要在前后添加任何文字。"
    : "如果要包代码围栏，请只包一层 ```json，且围栏内只有这个 JSON。"
  return [
    "上一轮的输出没有被接受，原因如下（字段路径 + 原因）：",
    paths,
    "请只返回一个 JSON 对象，不要附加任何解释文字。",
    formatAdvice
  ].join("\n")
}
