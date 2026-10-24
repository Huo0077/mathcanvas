import type { ParseError, ParseResult, PlanEnvelope } from "./contracts"
import type { PlanOutcome } from "./coordinatorPorts"
import { classifyStopReason } from "./modelEvents"
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
 * **按错误签名补一句"下一步怎么改"**（2026-10-11 用户现场；2026-10-17 更新）。
 *
 * 现场：同一条题连做四次，**三次**死在同一个签名上 —— 模型拿 `solid.create_polyhedron`
 * 去画"平面四边形 + 翻折片"这种**开放曲面**，而当时的多面体要求至少四个面、围出体积。
 * 引擎只回一句 `a polyhedron needs at least four faces`，那句话**没告诉它正确答案**
 *（我们其实有 `solid.create_face`，能力表里就有），于是下一轮它照样拿多面体去套，
 * 第三次还是同一堵墙 —— 而每一轮只有一次修复机会。
 *
 * **2026-10-17 用户裁定之后**：`solid.create_polyhedron` 本身兼容 **1 个面环**（平面多边形），
 * 所以"四边形 / 三角形片"不再被那条旧下限拒掉；仍然会触发这条提醒的只剩
 * "一个面环都没给"（`faces: []`）—— 那时它要么补一个环，要么改用 `solid.create_face`。
 *
 * 与 `planCompiler` 的 `targetedRepairAdvice` 同一条思路：**只按真实出现过的签名**给提醒，
 * 不做通用泛谈。
 */
/** 各动作族的**正确出口**：模型造了一个不存在的动作名时，这就是它真正该用的那一个。 */
const SOLID_EXITS = "要画**开放的平面图形**（四边形、三角形片、翻折片）请用 `solid.create_face` —— 它**自带面、也自带边**，所以不需要再找一个 3D 线段动作去补边；闭合实体用 `solid.create_polyhedron`；沿折痕翻折用 `solid.fold`。"

function targetedTransportAdvice(errors: readonly ParseError[]): string[] {
  const advice: string[] = []
  const emptyFaces = errors.some((error) => error.path.includes(".inputs.") && /polyhedron needs at least (three vertices|one face)/.test(error.detail))
  if (emptyFaces) {
    advice.push("提醒：`solid.create_polyhedron` 现在也接受**一个面环**的平面多边形（例如 `faces: [[0,1,2,3]]`，物化成一张面）。你这次连一个面环都没给；如果你要画的是开放的平面图形（四边形、三角形片、翻折片），也可以直接用 `solid.create_face`：给 `vertices`（至少三个**共面**、互不共线的点）与 `vertexNames` 就行，它**不收 `faces`**。只有闭合实体才需要至少四个面。")
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
  /**
   * **T1（2026-10-24）：先按结构化分类说话，再谈字段。**
   *
   * 截断、空输出、非 JSON、调用了未发布的工具这四种失败**都不是**"信封形状不对"，
   * 而它们在旧实现里一律落到最后那句"计划必须是一个 JSON 对象"上 —— 用户与下一次修复
   * 都被引向格式，真正的原因（长度上限、空响应、工具名）反而看不见。分类的判据只有
   * 一处（`planFailureDetail` 的前缀），这里只做分发。
   */
  if (isPlanFailureDetail(detail) && !detail.startsWith(SCHEMA_FAILURE_PREFIX)) {
    return describePlanFailureForUser(detail)
  }
  const errors = readSchemaFailureDetail(detail)
  const { actionIds, paths } = unregisteredActions(errors)
  if (actionIds.length === 0) {
    /**
     * **E3（T1）：一个字段类型错，不该被说成"整个信封不是对象"。**
     *
     * 现场：模型把 `size.x` 写成 `"bad"`，用户读到的是"计划必须是一个 JSON 对象" ——
     * 那句话把可修复的字段错误说成了一次形状灾难。判据是**错误落在哪个路径**：
     * 有任何一个错误指向 `envelope` 之下的字段，就点名那个字段（最多三处）；
     * 只有整个信封层面的错误（根路径 `envelope`）才用"必须是一个 JSON 对象"那句。
     */
    const fieldErrors = errors.filter((error) => error.path !== "envelope")
    if (fieldErrors.length > 0) {
      const named = fieldErrors.slice(0, 3).map((error) => `${error.path}（${error.detail}）`).join("；")
      const more = fieldErrors.length > 3 ? `，另有 ${fieldErrors.length - 3} 处同类问题` : ""
      return `模型的回答里**字段不合法**，所以这一轮停下了：${named}${more}。计划的对象形状是对的，问题在具体字段，按字段路径改就行。引擎的原话：${detail}`
    }
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

/* ------------------------------------------------------------------------- *
 * **规划失败的合同**（T1，2026-10-24）
 *
 * ## 这一节修的是什么
 *
 * 旧路径上，规划器解析失败时把**模型的原值**（可能是半截字符串、可能是解出来的对象）
 * 塞进 `PlanOutcome.plan`（`as PlanEnvelope`），协调器再 `parsePlanEnvelope` 一遍。
 * 后果有两类，都是现场复现过的：
 *
 * 1. **字段错误退化成字符串错误**（E1）：参数是双重编码的字符串，系统解出了对象、
 *    也认出 `actions[0].inputs.size.x` 不是有限数，但交出去的仍是**那段字符串**，
 *    于是下一层只报 `got a string` —— 具体的字段错误在这一层被抹掉了；
 * 2. **截断与空响应被误报成"不是 JSON 对象"**（E2）：`stopReason = "length"` 的信息
 *    在事件里明明有，规划器却没有把它当成一种**独立的失败**，用户看到的仍是形状错误。
 *
 * ## 合同
 *
 * 失败不是"一个不合法的计划"，而是**一次带分类、带字段错误、带结束原因的失败**。
 * `PlanOutcome` 因此是判别联合：成功给 `plan`（仍然不可信，协调器必须再校验一次），
 * 失败给 `failure`。`decoded` 只在"确实解出了一个对象"时才有 —— 它是让下一层
 * 能报**字段路径**而不是"got a string"的关键。
 *
 * ## 有界
 *
 * `payload` 与 `detail` 都截断。`payload` 只给修复提示认"缺了哪个键"与本机诊断，
 * **不进用户可见文案**；用户看到的是分类 + 字段路径（`describePlanFailureForUser`）。
 * ------------------------------------------------------------------------- */

export type PlanFailureCategory =
  | "response_incomplete"
  | "empty_output"
  | "invalid_json"
  | "schema_invalid"
  | "unexpected_tool_call"
  | "provider_refusal"

export interface PlanFailure {
  category: PlanFailureCategory
  channel: ModelChannel | "unknown"
  /** 逐条字段错误（`code` + `path` + `detail`）。非解析类失败也至少有一条。 */
  errors: ParseError[]
  /**
   * 能解成对象时**解出来的那个对象**（E1）。
   *
   * 它不是"校验通过的计划"：形状仍由协调器校验。它存在的唯一理由是让字段错误
   * 指得出路径 —— 没有它，双重编码的参数在下一层只能报 `got a string`。
   */
  decoded?: unknown
  /** provider 给的结束原因原文（`length` / `max_tokens` / `refusal` …），不改写、不丢。 */
  stopReason?: string
  /** 有界原文。**只**给修复提示与诊断，不进用户文案。 */
  payload: string
  /** 有界的一句话（分类 + 首个字段错误的 `code@path`），供账本与失败事件使用。 */
  detail: string
}

/** 账本里"计划没通过校验"那一句的前缀（`schemaFailureDetail` 的消费者靠它分类）。 */
export const SCHEMA_FAILURE_PREFIX = "the plan never matched the schema:"
const INVALID_JSON_PREFIX = "the plan never arrived as JSON:"
const EMPTY_OUTPUT_PREFIX = "the plan never arrived:"
const INCOMPLETE_PREFIX = "the plan was cut off before it finished:"
const REFUSAL_PREFIX = "the provider refused to generate a plan:"
const UNEXPECTED_TOOL_PREFIX = "the model called a tool this run did not publish:"

function stopSuffix(stopReason: string | undefined): string {
  return stopReason === undefined || stopReason.length === 0 ? "" : `（结束原因：${stopReason}）`
}

/** provider 的"到上限了"与"被拒了"两族结束原因 —— 归一含义只在一处判（`classifyStopReason`）。 */
function categoryFor(reason: EnvelopeParseFailure["reason"], payload: string, stopReason: string | undefined): PlanFailureCategory {
  const kind = classifyStopReason(stopReason)
  if (kind === "refusal") return "provider_refusal"
  if (kind === "length") return "response_incomplete"
  if (reason === "schema_invalid") return "schema_invalid"
  if (payload.trim().length === 0) return "empty_output"
  return "invalid_json"
}

/** 造一份失败。**所有分类都从这里过**，否则"哪些字段该有"就会各自分叉。 */
export function createPlanFailure(input: {
  category: PlanFailureCategory
  channel?: ModelChannel | "unknown"
  errors?: readonly ParseError[]
  decoded?: unknown
  stopReason?: string
  payload?: string
  detail?: string
}): PlanFailure {
  const payload = (input.payload ?? "").slice(0, 4096)
  const errors = input.errors === undefined || input.errors.length === 0
    ? [{ code: input.category, path: "envelope", detail: input.detail ?? input.category }]
    : [...input.errors]
  const first = errors[0]!
  const suffix = input.stopReason === undefined ? "" : ` (stopReason=${input.stopReason})`
  return {
    category: input.category,
    channel: input.channel ?? "unknown",
    errors,
    payload,
    ...(input.decoded === undefined ? {} : { decoded: input.decoded }),
    ...(input.stopReason === undefined ? {} : { stopReason: input.stopReason }),
    detail: `${first.code}@${first.path}: ${first.detail}${suffix}`.slice(0, 512)
  }
}

/**
 * 解析失败 → 失败合同。
 *
 * `decoded` 由调用方给：**模型规划器在"按 JSON 解过一次、解出来是对象"时把它递进来**，
 * 于是字段错误（`envelope.actions[0].inputs.size.x`）能一路传到修复提示与用户文案里。
 */
export function planFailureFromParseFailure(
  failure: EnvelopeParseFailure,
  extra: { decoded?: unknown; stopReason?: string } = {}
): PlanFailure {
  return createPlanFailure({
    category: categoryFor(failure.reason, failure.payload, extra.stopReason),
    channel: failure.channel,
    errors: failure.errors,
    payload: failure.payload,
    ...(extra.decoded === undefined ? {} : { decoded: extra.decoded }),
    ...(extra.stopReason === undefined ? {} : { stopReason: extra.stopReason })
  })
}

/** 账本与失败事件里的那句话。**按分类给前缀**，不与 `schemaFailureDetail` 混用。 */
export function planFailureDetail(failure: PlanFailure): string {
  switch (failure.category) {
    case "schema_invalid": return `${SCHEMA_FAILURE_PREFIX} ${schemaFailureDetail(failure.errors)}`
    case "invalid_json": return `${INVALID_JSON_PREFIX} ${failure.detail}`
    case "empty_output": return `${EMPTY_OUTPUT_PREFIX} the model returned no text${stopSuffix(failure.stopReason)}`
    case "response_incomplete": return `${INCOMPLETE_PREFIX} ${failure.detail}`
    case "unexpected_tool_call": return `${UNEXPECTED_TOOL_PREFIX} ${failure.detail}`
    case "provider_refusal": return `${REFUSAL_PREFIX} ${failure.detail}`
  }
}

/**
 * **读一份规划结局里的计划**（测试与评测入口的便捷读法）。
 *
 * 失败时**抛**：生产路径必须自己处理 `failure`（选择修复方向或如实失败），
 * 这里只是让"确实期望成功"的调用方少写一层判别。用 `as` 或可选链绕过它，
 * 等于把 T1 想消灭的那件事换个地方重演。
 */
export function planOf(outcome: PlanOutcome): PlanEnvelope {
  if ("failure" in outcome) throw new Error(`expected a plan, got a ${outcome.failure.category} failure: ${outcome.failure.detail}`)
  return outcome.plan
}

/** 这句话是不是"规划失败"那一族（`agentRunner` 据此决定用哪套用户文案）。 */export function isPlanFailureDetail(detail: string): boolean {
  return detail.startsWith(SCHEMA_FAILURE_PREFIX) ||
    detail.startsWith(INVALID_JSON_PREFIX) ||
    detail.startsWith(EMPTY_OUTPUT_PREFIX) ||
    detail.startsWith(INCOMPLETE_PREFIX) ||
    detail.startsWith(REFUSAL_PREFIX) ||
    detail.startsWith(UNEXPECTED_TOOL_PREFIX)
}

/** 按通道给的格式建议。**只有一处**，否则修复提示与解析器会各说一套。 */
function formatAdviceFor(channel: ModelChannel | "unknown"): string {
  if (channel === "strict_json") return "不要用代码围栏包住它，也不要在前后添加任何文字。"
  if (channel === "native_tools") return "请直接调用计划工具，参数必须是 JSON 对象本身，不要把对象再序列化成字符串。"
  return "如果要包代码围栏，请只包一层 ```json，且围栏内只有这个 JSON。"
}

/**
 * 失败 → **下一次要说的话**。
 *
 * 与 `describeRepairPrompt` 同一条纪律：给**字段路径**、给**这一轮真正缺的键**、
 * 按通道给格式建议、**绝不回显模型原文**（`missingEnvelopeFields` 只读键名）。
 * 区别只在开头那句：截断、空响应、拒绝各有各的说法，因为它们要求的**下一个动作不同**。
 */
export function describePlanFailureRepair(failure: PlanFailure): string {
  const paths = failure.errors.map((error) => `${error.path}: ${error.detail}`).join("; ")
  const opening = ((): string => {
    switch (failure.category) {
      case "response_incomplete":
        return `上一条输出**在结束前被截断**${stopSuffix(failure.stopReason)}。请重新输出**完整**的 JSON 对象：不要省略任何字段，不要依赖上文续写。${failure.stopReason === undefined ? "" : "如果是因为内容太长，先把动作拆成更小的步骤。"}`
      case "empty_output":
        return `上一条**没有返回任何正文**${stopSuffix(failure.stopReason)}。请直接输出完整的计划 JSON 对象；如果你需要先观察场景，请调用已发布的只读工具。`
      case "invalid_json":
        return "上一条输出**不是合法 JSON**（下面的字段路径是引擎实际读到的位置）。请只返回一个 JSON 对象。"
      case "unexpected_tool_call":
        return "上一条回复调用了一个**这一轮没有发布的工具**。请只使用这一轮发布过的工具；如果这一轮发布了「plan_set_plan」，就直接调用它，否则用文本返回 JSON 信封。"
      case "provider_refusal":
        return `服务端**明确拒绝**了这次生成${stopSuffix(failure.stopReason)}。不要重发同一份请求；如果题目本身无法生成，请在「questions」里如实说明。`
      case "schema_invalid":
        return "上一轮的输出没有被接受，原因如下（字段路径 + 原因）："
    }
  })()
  return [
    opening,
    ...[paths.length > 0 ? [paths] : []],
    ...missingEnvelopeFields(failure.payload),
    ...targetedTransportAdvice(failure.errors),
    "请只返回一个 JSON 对象，不要附加任何解释文字。",
    formatAdviceFor(failure.channel)
  ].join("\n")
}

/**
 * 失败 → **给用户的那句话**。
 *
 * 分类来自 `planFailureDetail` 的前缀（唯一生产方），不从长文本里猜。
 * 每一类都要说清两件事：**为什么停下**、**下一次会不会不一样**（是否已用掉修复名额）。
 */
export function describePlanFailureForUser(detail: string): string {
  const stop = /（结束原因：([^）]+)）|\(stopReason=([^)]+)\)/.exec(detail)
  const stopReason = stop?.[1] ?? stop?.[2] ?? ""
  const suffix = `引擎的原话：${detail}`
  if (detail.startsWith(INCOMPLETE_PREFIX)) {
    return `模型的输出在传输中**被截断**了${stopReason ? `（结束原因：${stopReason}）` : ""}，这一轮没有拿到完整的计划。系统会按有界恢复再问一次；如果仍被截断，就是这次生成的输出上限不够，需要放宽上限或把题目拆小。${suffix}`
  }
  if (detail.startsWith(EMPTY_OUTPUT_PREFIX)) {
    return `模型这一次**没有返回任何正文**${stopReason ? `（结束原因：${stopReason}）` : ""}，所以没有计划可以编译。系统会按有界恢复再问一次。${suffix}`
  }
  if (detail.startsWith(INVALID_JSON_PREFIX)) {
    return `模型返回的内容**不是合法 JSON**，所以这一轮停下了（这不是字段写法的问题，是整段输出没构成 JSON）。系统会按有界恢复再问一次，并把通道要求的格式再说一遍。${suffix}`
  }
  if (detail.startsWith(UNEXPECTED_TOOL_PREFIX)) {
    return `模型调用了一个**这一轮没有发布的工具**，所以没有执行任何动作。这不是你操作的问题；系统会按有界恢复再问一次，并说明这一轮可用的工具。${suffix}`
  }
  if (detail.startsWith(REFUSAL_PREFIX)) {
    return `服务商**明确拒绝**了这次生成${stopReason ? `（结束原因：${stopReason}）` : ""}，所以这一轮停下了。换一份模型服务或改写题目再试。${suffix}`
  }
  return detail
}
