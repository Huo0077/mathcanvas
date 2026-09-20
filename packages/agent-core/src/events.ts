import type { RunPhase } from "./runState"

/**
 * **运行遥测与脱敏**（Task 2.6）。
 *
 * 计划点名的三条：
 * - 事件要带全 run / conversation / prompt / request / attempt / tool / draft / consent / commit 这些标识，
 *   外加阶段、状态、耗时、用量、版本与**已脱敏**的诊断；
 * - `redactDiagnostic(value, knownSecrets)` 去掉 Authorization、密钥值、代理口令与查询串里的秘密；
 * - `appendRunEvent` 是**只追加**且**按事件 id 幂等**的，并且**绝不存原始模型推理或图像字节**。
 *
 * ## 为什么脱敏要在这个包里、而不是在写日志的地方
 *
 * 日志点会越来越多（协调器、代理、宿主桥……），每个点各写一遍脱敏必然漏 ——
 * 而漏一次的后果是**密钥进了磁盘**。所以规则只有一份，而且它**默认拒绝**：
 * 任何看起来像长随机串的东西都被替换，而不是等一份清单来告诉它"这个才是密钥"。
 *
 * ## 为什么"绝不存推理与图像"要做成结构检查
 *
 * `appendRunEvent` 会在写入前**看一眼**事件里有没有 `reasoning` / `imageBytes` 这类字段并**拒绝**。
 * 这比"记得不要传"可靠：将来有人顺手把整条 provider 响应塞进诊断，这里会当场拦下。
 */

/** 计划点名的九类标识。全部必填（`null` 表示"这一刻还不知道"）。 */
export interface RunTelemetryIds {
  runId: string
  conversationId: string
  promptMessageId: string
  requestId: string | null
  attemptId: string | null
  toolCallId: string | null
  draftId: string | null
  consentNonce: string | null
  commitId: string | null
}

export interface RunUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface RunEventRecord extends RunTelemetryIds {
  /** 事件自己的 id：**幂等的依据**。 */
  eventId: string
  sequence: number
  at: number
  phase: RunPhase
  status: "ok" | "warning" | "error"
  /** 毫秒；未知时缺省。 */
  durationMs?: number
  usage?: RunUsage
  /** 版本三方：能力注册表 / 工具目录 / 计划 schema。事后对账靠它们。 */
  versions: { capability: string; toolCatalogue: string; planSchema: string }
  /** **已经脱敏**的诊断文本。 */
  diagnostics: string[]
}

export type AppendOutcome =
  | { ok: true; appended: boolean; reason: "appended" | "duplicate" }
  | { ok: false; reason: "prohibited_field" | "invalid_event"; detail: string }

/** 明文里的敏感字段名（小写匹配）。 */
const SECRET_KEYS = ["authorization", "api-key", "apikey", "x-api-key", "password", "passwd", "secret", "token", "access_token", "refresh_token", "cookie", "set-cookie", "proxy-authorization", "bearer"]
/** 查询串里需要抹掉的参数名。 */
const SECRET_QUERY_KEYS = ["key", "api_key", "apikey", "token", "access_token", "password", "secret", "sig", "signature"]
/**
 * `sk-…` / `sk-ant-…` 这类前缀串：**没有已知秘密清单时**也应当被替换。
 *
 * 这条是"默认拒绝"的落点：脱敏不能依赖调用方记得把每个密钥都传进 `knownSecrets`。
 */
const SECRET_PREFIX = /\b(?:sk|rk|pk|ghp|gho|xox[baprs])-[A-Za-z0-9_-]{8,}\b/gi
/** 长随机串（32 位以上无空格）。真实密钥几乎都长这样，而普通诊断不会。 */
const LONG_RANDOM = /\b[A-Za-z0-9_-]{32,}\b/g
const MAX_DIAGNOSTIC_CHARACTERS = 512
/** 一次运行最多保留多少条事件：内存里的账本必须有界。 */
export const MAX_EVENTS_PER_RUN = 2_000

/** **绝不入库**的字段名：原始模型推理与图像字节。 */
const PROHIBITED_KEYS = ["reasoning", "chainofthought", "chain_of_thought", "thinking", "imagebytes", "image_bytes", "rawimage", "rawbytes"]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * 去掉一段文本里的秘密。
 *
 * 顺序有意：**先替换已知秘密**（最精确），再按字段名替换（`Authorization: …`），
 * 再抹查询串里的秘密，最后用"长随机串"兜底。已知秘密必须最先做，否则它可能先被别的规则切碎。
 */
export function redactDiagnostic(value: unknown, knownSecrets: readonly string[] = []): string {
  let text = typeof value === "string" ? value : safeStringify(value)

  for (const secret of knownSecrets) {
    if (secret.length === 0) continue
    text = text.replaceAll(secret, "[redacted]")
  }

  // `Authorization: Bearer xxx` / `"apiKey": "xxx"` 这类结构化写法。
  for (const key of SECRET_KEYS) {
    const pattern = new RegExp(`(["']?${escapeRegExp(key)}["']?\\s*[:=]\\s*)(["']?)([^"'\\s,;}]+)`, "gi")
    text = text.replace(pattern, (_match, head: string, quote: string) => `${head}${quote}[redacted]`)
  }

  // URL 查询串里的 `key=` / `token=` 等。
  for (const key of SECRET_QUERY_KEYS) {
    const pattern = new RegExp(`([?&]${escapeRegExp(key)}=)([^&\\s]*)`, "gi")
    text = text.replace(pattern, "$1[redacted]")
  }

  text = text.replace(SECRET_PREFIX, "[redacted]")
  text = text.replace(LONG_RANDOM, "[redacted]")

  return text.slice(0, MAX_DIAGNOSTIC_CHARACTERS)
}

function safeStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  try {
    // 循环引用不该让脱敏本身抛错（它会在错误路径上被调用，那时抛错最难查）。
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function hasProhibitedField(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || typeof value !== "object") return null
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = hasProhibitedField(entry, depth + 1)
      if (found) return found
    }
    return null
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PROHIBITED_KEYS.includes(key.toLowerCase())) return key
    const found = hasProhibitedField(child, depth + 1)
    if (found) return found
  }
  return null
}

export interface RunEventLedger {
  /** 只追加；同 `eventId` 再来一次是 **no-op**（幂等），不是错误。 */
  append(event: RunEventRecord): AppendOutcome
  events(): readonly RunEventRecord[]
  /** 按 `eventId` 查一条：提交回执的恢复靠它（计划 Step 1 的 "commit-receipt recovery"）。 */
  byId(eventId: string): RunEventRecord | undefined
  size(): number
}

export function createRunEventLedger(): RunEventLedger {
  const records: RunEventRecord[] = []
  const seen = new Set<string>()

  return {
    append(event) {
      if (typeof event.eventId !== "string" || event.eventId.length === 0) {
        return { ok: false, reason: "invalid_event", detail: "an event needs a non-empty eventId" }
      }
      const prohibited = hasProhibitedField(event)
      if (prohibited) {
        // 拒绝而不是"过滤掉那个字段"：静默丢弃会让人以为日志里已经有完整信息了。
        return { ok: false, reason: "prohibited_field", detail: `event carries '${prohibited}', which must never be stored` }
      }
      if (seen.has(event.eventId)) return { ok: true, appended: false, reason: "duplicate" }

      seen.add(event.eventId)
      records.push(event)
      if (records.length > MAX_EVENTS_PER_RUN) records.splice(0, records.length - MAX_EVENTS_PER_RUN)
      return { ok: true, appended: true, reason: "appended" }
    },
    events: () => [...records],
    byId: (eventId) => records.find((record) => record.eventId === eventId),
    size: () => records.length
  }
}

/** 构造一条事件的便捷函数：标识处一处填，避免调用点漏字段。 */
export function createRunEvent(input: Omit<RunEventRecord, "versions" | "diagnostics"> & { versions: RunEventRecord["versions"]; diagnostics?: unknown[]; knownSecrets?: readonly string[] }): RunEventRecord {
  const { diagnostics = [], knownSecrets = [], ...rest } = input
  return { ...rest, diagnostics: diagnostics.map((entry) => redactDiagnostic(entry, knownSecrets)) }
}
