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
    /**
     * **点名缺了哪个顶层字段**（2026-10-04 加，来自真实运行）。
     *
     * 用户现场：模型两次都没给出合法的信封 —— 第一次连 `kind` 都没有，第二次把
     * `schemaVersion` / `kind` / `goal` / `factIds` / `assumptions` 都写了，**却漏了 `actions`**，
     * 于是引擎只说 `invalid_type@envelope.actions: expected an array`。
     * 那句话对模型没有任何新增信息（它并不知道"一个 plan 必须有 actions"这条合同细节），
     * 所以第二次照样漏。这里把**具体缺的键**列出来 —— 这是唯一能让第二轮真正不同的信息。
     */
    ...missingEnvelopeFields(failure.payload),
    ...targetedTransportAdvice(failure.errors),
    "请只返回一个 JSON 对象，不要附加任何解释文字。",
    formatAdvice
  ].join("\n")
}

/**
 * **按错误签名补一句"下一步怎么改"**（2026-10-11 用户现场）。
 *
 * 现场：同一条题连做四次，**三次**死在同一个签名上 —— 模型拿 `solid.create_polyhedron`
 * 去画"平面四边形 + 翻折片"这种**开放曲面**，而多面体要求至少四个面、围出体积。
 * 引擎只回一句 `a polyhedron needs at least four faces`，那句话**没告诉它正确答案**
 *（我们其实有 `solid.create_face`，能力表里就有），于是下一轮它照样拿多面体去套，
 * 第三次还是同一堵墙 —— 而每一轮只有一次修复机会。
 *
 * 与 `planCompiler` 的 `targetedRepairAdvice` 同一条思路：**只按真实出现过的签名**给提醒，
 * 不做通用泛谈。判据里两个数都收（面 / 顶点）：它们不够的根因是同一个 —— 那只图形没围起来。
 */
/** 各动作族的**正确出口**：模型造了一个不存在的动作名时，这就是它真正该用的那一个。 */
const SOLID_EXITS = "要画**开放的平面图形**（四边形、三角形片、翻折片）请用 `solid.create_face` —— 它**自带面、也自带边**，所以不需要再找一个 3D 线段动作去补边；闭合实体用 `solid.create_polyhedron`；沿折痕翻折用 `solid.fold`。"

function targetedTransportAdvice(errors: readonly ParseError[]): string[] {
  const advice: string[] = []
  const openFigure = errors.some((error) => error.path.includes(".inputs.") && /polyhedron needs at least four (faces|vertices)/.test(error.detail))
  if (openFigure) {
    advice.push("提醒：`solid.create_polyhedron` 建的是**闭合多面体**（至少四个面、要围出体积）。要画**开放的平面图形**（四边形、三角形片、翻折片）请改用 `solid.create_face`：给 `vertices`（至少三个**共面**、互不共线的点）与 `vertexNames` 就行，它**不收 `faces`**。一张平面的四边形或三角形片，用多面体是套不上的。")
  }
  /**
   * **模型自己造了一个动作名**（Task 2，2026-10-12）。
   *
   * 现场第二轮：上一轮刚被"开放图形别用闭合多面体"挡过，这一轮它**换了个不存在的动作** ——
   * `solid.create_segment` ×3。原提示只把三条路径列出来（`unregistered action '…'`），
   * **没有说"这个动作不存在"，也没有说该用哪个**，于是那唯一一次修复机会照样浪费。
   *
   * 与上面那条同一条纪律：**只按真实出现过的签名给建议**。造的是平面动作名时不说 3D 的出口
   *（那会把提示引到另一个族去）；这一点由 `outputParser.test.ts` 的反例钉住。
   */
  const invented = [...new Set(errors
    .filter((error) => error.code === "unknown_action")
    .map((error) => /unregistered action '([^']+)'/.exec(error.detail)?.[1])
    .filter((name): name is string => typeof name === "string"))]
  if (invented.length > 0) {
    const named = invented.map((name) => `\`${name}\``).join("、")
    const solidOnes = invented.filter((name) => name.startsWith("solid."))
    advice.push(`提醒：动作表里**没有** ${named} —— **不要自己造动作名**。${solidOnes.length > 0 ? SOLID_EXITS : "请只用上面列出的、已发布的那几个动作。"}`)
  }
  return advice
}

/**
 * 顶层**仍然必填**的字段，按 `kind` 分。**只列键名，不回显模型的内容。**
 *
 * 2026-10-04 用户同意放宽后调整：`schemaVersion` / `factIds` / `kind` 已改为**可推断**
 *（见 `schemas.ts` 里那两段注释），所以它们**不再出现在这张表里** —— 再要求模型补
 * 一个系统自己能补的字段，只会制造又一轮无谓失败。
 */
const REQUIRED_ENVELOPE_FIELDS: Record<string, readonly string[]> = {
  plan: ["goal", "actions"],
  clarification: ["goal", "questions"],
  answer: ["goal", "answer", "toolResultRefs"]
}

/**
 * 从被拒的原始输出里认出**缺了哪些顶层必需字段**，返回一行给修复提示。
 *
 * 认不出（不是对象、不是合法 JSON）就返回空数组 —— **不猜**。
 * 这条与"不回显模型原文"并不冲突：它只说**键名**，不说内容。
 */
function missingEnvelopeFields(payload: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return []
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return []
  const record = parsed as Record<string, unknown>
  // 与解析层同一套推断：带 actions 就是 plan。
  const kind = typeof record.kind === "string"
    ? record.kind
    : "actions" in record ? "plan" : "questions" in record ? "clarification" : "answer"
  const required = REQUIRED_ENVELOPE_FIELDS[kind]
  if (!required) return []
  const missing = required.filter((field) => !(field in record))
  if (missing.length === 0) return []
  return [`你这一份**缺了顶层必填字段**：${missing.join("、")}。${kind === "plan" ? "kind 为 plan 时 actions 必填，且必须是数组。" : ""}`]
}

/**
 * **Task 2（2026-10-12）："动作名不认识"不是"顶层 JSON 形状不合法"。**
 *
 * ## 现场
 *
 * 22:36 那条轨迹的第二轮：模型自己造了一个动作名 `solid.create_segment` 用了**三次**。
 * 那一份信封的**顶层形状完全合法**（`schemaVersion` / `kind` / `goal` / `actions` 一个不缺），
 * 错的只是三个动作名。而用户看到的是"模型的回答不符合计划合同的形状……计划必须是一个 JSON 对象
 * （schemaVersion / kind / goal，外加 actions 或 questions 或 answer）" —— **一句误诊**：
 * 它把模型指向了信封格式，而真正该改的是动作名，且**引擎手里有正确答案**
 *（`solid.create_face` 一张面片自带面边，根本不需要一条 3D 线段动作）。
 *
 * ## 为什么是"生产方与消费方成对写在一个模块里"
 *
 * 用户话要在应用层说（`agentRunner`），而错误列表在引擎层（`coordinator`）——
 * 中间只隔着账本事件的那一句 `detail`，而**事件形状由 Rust 侧定死**（`deny_unknown_fields`），
 * 加不了结构化字段。所以这里把**渲染与还原这一对**放进同一个模块：
 * `schemaFailureDetail` 是账本那一句的**唯一生产方**，`readSchemaFailureDetail` 是它的逆运算。
 * 两边的格式由这两条函数与它们自己的用例钉住 —— 比在下游用 `detail.includes(...)` 猜要硬得多。
 *
 * **只分类，不猜内容**：认不出的错误原样交给通用的那一句，绝不把未知情况说成"动作名错"。
 */
export interface EnvelopeFieldError {
  code: string
  path: string
  detail: string
}

/** 账本里"计划没通过校验"那一句的**唯一生产方**。改这个格式必须同时改 `readSchemaFailureDetail`。 */
export function schemaFailureDetail(errors: readonly ParseError[], limit = 512): string {
  return errors.map((error) => `${error.code}@${error.path}: ${error.detail}`).join(", ").slice(0, limit)
}

/**
 * `schemaFailureDetail` 的逆运算。**容忍被截断的尾巴**（生产方会 `slice`）：
 * 读得出几条算几条，不抛、不猜。
 *
 * 切分不用 `split(", ")`：`detail` 本身可能带逗号。只有在 `, ` 后面**紧跟**
 * `码@路径: ` 这个形状时才切一刀。
 */
export function readSchemaFailureDetail(detail: string): EnvelopeFieldError[] {
  const starts: number[] = []
  const pattern = /(?:^|, )([A-Za-z_]+)@([^:,]+): /g
  const matches: { index: number; end: number; code: string; path: string }[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(detail)) !== null) {
    starts.push(match.index)
    matches.push({ index: match.index, end: match.index + match[0].length, code: match[1], path: match[2] })
  }
  return matches.map((entry, index) => {
    const next = matches[index + 1]
    // 下一条的起点回退掉分隔用的 ", "（没有下一条时吃到结尾）。
    const stop = next === undefined ? detail.length : next.index
    return { code: entry.code, path: entry.path, detail: detail.slice(entry.end, stop).replace(/, $/, "").trim() }
  })
}

/** 从错误列表里认出**模型自己造的动作名**（`schemas.ts` 那句 `unregistered action '…'`）。 */
function unregisteredActions(errors: readonly EnvelopeFieldError[]): { actionIds: string[]; paths: string[] } {
  const actionIds: string[] = []
  const paths: string[] = []
  for (const error of errors) {
    if (error.code !== "unknown_action") continue
    const named = /unregistered action '([^']+)'/.exec(error.detail)
    if (named === null) continue
    actionIds.push(named[1])
    paths.push(error.path)
  }
  return { actionIds, paths }
}

/** "开放图形被硬塞进闭合多面体"那个签名（与 `targetedTransportAdvice` 同一个判据）。 */
function isOpenFigureForcedIntoPolyhedron(errors: readonly EnvelopeFieldError[]): boolean {
  return errors.some((error) => error.path.includes(".inputs.") && /polyhedron needs at least four (faces|vertices)/.test(error.detail))
}

/**
 * **给用户看的那一句话**（`agentRunner` 的 `failed` 分支用它，取代原先的 `detail.includes(...)` 猜法）。
 *
 * - 真·顶层形状不对（数组、散文、不是对象）⇒ 保留原来那句"计划必须是一个 JSON 对象"；
 * - 动作名不认识 ⇒ 点名那个动作、列出**它出现的每一条路径**，并说出正确出口；
 * - 传了 `earlierDetails` 且上一轮是"开放图形硬塞多面体" ⇒ 把上一轮那句建议一起摆出来 ——
 *   那正是模型走偏的原因，用户看得见因果才判断得了该不该重试。
 */
export function describeSchemaFailureForUser(detail: string, earlierDetails: readonly string[] = []): string {
  const errors = readSchemaFailureDetail(detail)
  const { actionIds, paths } = unregisteredActions(errors)
  if (actionIds.length === 0) {
    return `模型的回答不符合计划合同的形状，所以这一轮停下了。计划必须是一个 JSON 对象（schemaVersion / kind / goal，外加 actions 或 questions 或 answer）。引擎的原话：${detail}`
  }
  const named = [...new Set(actionIds)].join("、")
  const where = paths.join("、")
  const earlierOpenFigure = earlierDetails.some((earlier) => isOpenFigureForcedIntoPolyhedron(readSchemaFailureDetail(earlier)))
  const lines = [
    `模型用了一个**不存在的动作**：${named}（出现在 ${where}）。动作表里没有这个名字，所以这一轮停下了。`,
    // 说清"不是信封的错"——否则用户与下一次修复都会被引到格式上去。
    "这一份信封的顶层形状（schemaVersion / kind / goal / actions）是合法的，问题只在动作名。",
    ...(actionIds.some((actionId) => actionId.startsWith("solid.")) || earlierOpenFigure ? [SOLID_EXITS] : []),
    ...(earlierOpenFigure ? ["上一轮引擎其实已经给过这句话 —— 这一轮它换了个不存在的动作名，而不是改用它。"] : [])
  ]
  return `${lines.join(" ")} 引擎的原话：${detail}`
}
