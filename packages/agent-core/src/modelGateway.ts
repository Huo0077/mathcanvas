import type { ModelChannel } from "./outputParser"

/**
 * **模型网关与通道选择**（Task 2.3 Step 3）。
 *
 * 计划原文：`ModelGateway.generate(context, tools, profile): AsyncIterable<ModelEvent>`
 * 支持原生工具、严格 JSON、文本信封三种通道，并且：
 * - **Do not send a tool schema to providers that failed capability verification**；
 * - **return `CAPABILITY_UNAVAILABLE` when no safe channel remains**。
 *
 * ## 为什么"能力证据"必须显式，而不能靠探测
 *
 * 一个 provider 声称兼容 OpenAI 并不代表它支持 tools。把工具 schema 发给一个会**静默忽略**它的
 * 服务，结果是模型在散文里"描述"它想调用什么，而系统这边什么也没发生 —— 用户看到一段解释、
 * 画布上什么都没变。所以通道选择只能依据**已验证的证据**（`capabilities`），
 * 而不是依据品牌名或"看起来兼容"。
 *
 * 三种通道的能力要求：
 * | 通道 | 需要什么证据 |
 * | --- | --- |
 * | `native_tools` | `tools === "verified"`（**唯一**敢发工具 schema 的情形） |
 * | `strict_json` | `json === "verified"` |
 * | `fenced_text` | 无需额外能力（任何会说话的模型都能返回一段文本） |
 *
 * 一个都不会用、或者全都失败时返回 `CAPABILITY_UNAVAILABLE` 并且**如实说明缺哪一项证据** ——
 * 这比伪造一个通道然后失败要好。
 */

export type CapabilityEvidence = "verified" | "declared" | "failed" | "unknown"

export interface ProviderCapabilities {
  /** 原生工具调用（function calling）。 */
  tools: CapabilityEvidence
  /** 严格 JSON 输出（response_format / 结构化输出）。 */
  json: CapabilityEvidence
  /** 视觉输入（图像题需要）。 */
  vision: CapabilityEvidence
}

export interface ProviderProfile {
  id: string
  /** 显示的协议/方言名，只用于展示与诊断，**不参与通道选择**。 */
  dialect: string
  /** 模型 id。 */
  modelId: string
  capabilities: ProviderCapabilities
}

export type ChannelSelection =
  | { ok: true; channel: ModelChannel }
  | { ok: false; reason: "CAPABILITY_UNAVAILABLE"; detail: string; missing: (keyof ProviderCapabilities)[] }

/**
 * 选通道。顺序固定：原生工具 → 严格 JSON → 文本信封。
 *
 * `declared` **不算**已验证：声明与实测是两件事，而发错通道的代价是静默失败。
 * 只有 `verified` 才允许发工具 schema。
 */
export function selectChannel(profile: ProviderProfile, needsTools: boolean): ChannelSelection {
  if (needsTools) {
    return profile.capabilities.tools === "verified"
      ? { ok: true, channel: "native_tools" }
      : { ok: false, reason: "CAPABILITY_UNAVAILABLE", detail: `provider ${profile.id} has no verified native tool support (tools=${profile.capabilities.tools})`, missing: ["tools"] }
  }

  if (profile.capabilities.json === "verified") return { ok: true, channel: "strict_json" }

  // 文本信封不需要额外能力：任何会返回文本的模型都能用，只是要过解析器。
  // 这里刻意**不检查** `json`：文本通道的解析器自己会剥一层围栏并做 schema 校验。
  return { ok: true, channel: "fenced_text" }
}

/**
 * 视觉输入是否可用。
 *
 * 与通道选择分开是因为它决定的是"这次运行能不能带图"，而不是"输出走哪条路"，
 * 而且计划 Task 2.3 明确要求"a successful text ping must not mark vision verified"。
 */
export function canSendImages(profile: ProviderProfile): boolean {
  return profile.capabilities.vision === "verified"
}

export interface ModelRequest {
  profile: ProviderProfile
  /** 已经组装好的上下文（由 `buildContext` 产出）。 */
  context: unknown
  /** 这次是否必须走工具通道（例如已经确认要提交动作）。 */
  needsTools: boolean
  /** 是否要带图像（只有 `canSendImages` 为真才允许为 true）。 */
  withImages?: boolean
}

export type ModelRequestPlan =
  | { ok: true; channel: ModelChannel; sendToolSchema: boolean; sendImages: boolean }
  | { ok: false; reason: "CAPABILITY_UNAVAILABLE"; detail: string; missing: (keyof ProviderCapabilities)[] }

/**
 * 把一次调用**计划**成"走哪条通道、发不发工具 schema、带不带图"。
 *
 * 这个计划是纯函数、可测、且在真正调用 provider 之前完成 —— 所以"不该发的 schema 发出去了"
 * 或"没验证视觉却带了图"这类错误**在发出请求之前**就被拦住。
 */
export function planModelRequest(request: ModelRequest): ModelRequestPlan {
  const wantImages = request.withImages === true
  if (wantImages && !canSendImages(request.profile)) {
    return { ok: false, reason: "CAPABILITY_UNAVAILABLE", detail: `provider ${request.profile.id} has no verified vision support (vision=${request.profile.capabilities.vision})`, missing: ["vision"] }
  }
  const selection = selectChannel(request.profile, request.needsTools)
  if (!selection.ok) return selection
  return { ok: true, channel: selection.channel, sendToolSchema: selection.channel === "native_tools", sendImages: wantImages }
}
