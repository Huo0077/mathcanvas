import type { ParseResult } from "./contracts"

/**
 * **Provider 配置契约**（Task 1.3）。
 *
 * 计划给的接口是 `ProviderProfile { id; name; protocol; dialect; baseUrl; modelId;
 * secretRef?; capabilities; networkPolicy; revision }`，并逐条点名要校验的东西：
 * "required fields, HTTPS rules, duplicate names/IDs, **secret omission**, custom Base URL
 * normalization, and profile revision increments"。
 *
 * ## 三条纪律
 *
 * 1. **配置里永远没有密钥，只有引用**。`secretRef` 指向凭据库里的条目（Task 1.2），
 *    而 `secret` / `apiKey` 这类字段**出现即拒绝**（不是"忽略掉"）。忽略会让调用方以为
 *    自己刚刚把密钥存进去了 —— 那比报错糟得多。
 * 2. **协议与方言都是闭集**。`protocol` 决定用哪个适配器，`dialect` 决定"同一个协议下的
 *    不同实现"（"OpenAI 兼容"不是一个东西：有的支持工具、有的不支持流式、有的两边都不支持）。
 *    说"官方支持 OpenAI 兼容"是不诚实的，所以方言必须显式选。
 * 3. **明文只允许去本地**。非 `local` / `lan` 的端点**必须** HTTPS —— 否则密钥会以明文
 *    走过网络。这不是可配置项，是判据：`http://` + `networkPolicy: "cloud"` 直接拒绝。
 *
 * ## 为什么校验在 `agent-core` 而不是在设置界面里
 *
 * 因为**同一个 profile 会被两处用到**：界面（用户编辑）与适配器（发请求）。
 * 校验写在界面里，适配器就只能"相信界面已经查过了" —— 而配置也可以从文件导入。
 */

export const PROVIDER_PROTOCOLS = ["openai_compatible", "anthropic", "ollama"] as const
export type ProviderProtocol = (typeof PROVIDER_PROTOCOLS)[number]

/**
 * **方言**：同一协议下的不同实现。
 *
 * 为什么需要它：计划 Task 1.4 Step 3 要求 "Implement OpenAI-compatible path selection as an
 * explicit dialect. **Do not assume every compatible service supports the same tools, JSON,
 * vision, or streaming shape.**" 所以方言不是标签，而是"这个端点到底支持什么"的声明，
 * 适配器据此决定发什么形状的请求。
 */
export const PROVIDER_DIALECTS = ["openai_native", "deepseek", "moonshot", "generic_compatible", "anthropic_messages", "ollama_native"] as const
export type ProviderDialect = (typeof PROVIDER_DIALECTS)[number]

/** 方言 → 它属于哪个协议。**不匹配的方言与协议组合直接拒绝**。 */
export const DIALECTS_BY_PROTOCOL: Record<ProviderProtocol, readonly ProviderDialect[]> = {
  openai_compatible: ["openai_native", "deepseek", "moonshot", "generic_compatible"],
  anthropic: ["anthropic_messages"],
  ollama: ["ollama_native"]
}

/**
 * 网络策略。**决定"要不要 HTTPS"以及"要不要阻止私网地址"**。
 *
 * - `cloud`：公网端点。必须 HTTPS；私网地址**禁止**（防 SSRF）。
 * - `lan`：局域网里的自建服务。允许 `http://` 与私网地址 —— 这是**用户显式选择**的信任，
 *   而不是默认放开。
 * - `local`：本机（通常就是 Ollama）。允许 `http://127.0.0.1`，私网地址也放行。
 */
export const NETWORK_POLICIES = ["cloud", "lan", "local"] as const
export type NetworkPolicy = (typeof NETWORK_POLICIES)[number]

/** 能力证据的状态。`declared` **不算**已验证（计划 Task 1.4 Step 5）。 */
export const PROVIDER_CAPABILITY_STATUSES = ["unknown", "declared", "verified", "failed"] as const
export type ProviderCapabilityStatus = (typeof PROVIDER_CAPABILITY_STATUSES)[number]

export interface ProviderCapabilityEvidence {
  /** `tools` / `json` / `vision` / `streaming`。 */
  feature: string
  status: ProviderCapabilityStatus
  /** 什么时候验的（毫秒）。`declared` 不需要时间。 */
  checkedAt?: number
  /** 失败原因（人话）；成功时缺省。 */
  detail?: string
}

export interface ProviderProfile {
  id: string
  name: string
  protocol: ProviderProtocol
  dialect: ProviderDialect
  baseUrl: string
  modelId: string
  /** **只有引用**：真正的密钥在系统凭据库里（Task 1.2）。 */
  secretRef?: string
  capabilities: ProviderCapabilityEvidence[]
  networkPolicy: NetworkPolicy
  /** 每次成功写入递增；适配器与健康记录都带它，用于发现"配置换了但证据是旧的"。 */
  revision: number
}

export interface ProviderHealth {
  status: "unknown" | "ok" | "degraded" | "failed"
  latencyMs?: number
  capabilityEvidence: ProviderCapabilityEvidence[]
  checkedAt: number
  /** 这份证据对应哪一版 profile。**与当前 revision 不符的证据不该被当成本次的依据**。 */
  profileRevision: number
}

export const MAX_MODEL_ID_LENGTH = 128
const MAX_NAME_LENGTH = 64
const MAX_ID_LENGTH = 64
const MAX_URL_LENGTH = 512
const MAX_CAPABILITIES = 8

/**
 * 配置里**绝不允许出现**的字段。出现即拒绝（不是忽略）。
 *
 * 判据是"这两个词只可能装密钥"：`secret` 与 `apiKey`（含大小写与连字符变体）。
 * 反过来，`secretRef` 是允许的 —— 它装的是**条目的名字**，不是密钥。
 */
const FORBIDDEN_SECRET_FIELDS = ["secret", "secretvalue", "secret_value", "apikey", "api_key", "key", "token", "password", "credential"]

/** 本机与私网地址的判据（防 SSRF 用；`cloud` 策略下必须拒绝）。 */
function isPrivateHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true
  if (normalized === "::1") return true
  if (normalized.startsWith("127.")) return true
  if (normalized.startsWith("10.")) return true
  if (normalized.startsWith("192.168.")) return true
  // 172.16–172.31
  const match = /^172\.(\d{1,3})\./.exec(normalized)
  if (match) {
    const second = Number(match[1])
    if (second >= 16 && second <= 31) return true
  }
  // 169.254/16（云元数据服务就在这一段上）
  if (normalized.startsWith("169.254.")) return true
  return false
}

function fail(code: string, path: string, detail: string) {
  return { code, path, detail }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * **规范化 Base URL**。
 *
 * 四件事，每件都有理由：
 * 1. 去首尾空白（用户复制粘贴时一定带）；
 * 2. 去掉**末尾斜杠**（`…/v1` 与 `…/v1/` 是同一个端点，留着两个会让"重复检测"漏掉）；
 * 3. 丢掉 query 与 fragment（API 基址不该带查询串；带着它多半是从文档里粘错了一整行）；
 * 4. **拒绝内嵌的用户名密码**（`https://user:pass@host`）—— 那是把密钥写在 URL 里，
 *    而我们刚刚才把密钥限制在凭据库里。
 */
export function normalizeBaseUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, reason: "a base URL is required" }
  if (trimmed.length > MAX_URL_LENGTH) return { ok: false, reason: `the base URL exceeds ${MAX_URL_LENGTH} characters` }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, reason: "the base URL must be absolute, including the scheme" }
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "only http and https endpoints are supported" }
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return { ok: false, reason: "credentials must not be embedded in the base URL; use the secret store instead" }
  }
  // 丢掉 query / fragment，再去掉末尾斜杠。
  const path = parsed.pathname.replace(/\/+$/, "")
  return { ok: true, url: `${parsed.protocol}//${parsed.host}${path}` }
}

function readCapabilities(value: unknown, errors: ReturnType<typeof fail>[]): ProviderCapabilityEvidence[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    errors.push(fail("invalid_type", "profile.capabilities", "expected an array of capability evidence entries"))
    return []
  }
  if (value.length > MAX_CAPABILITIES) {
    errors.push(fail("array_too_long", "profile.capabilities", `max ${MAX_CAPABILITIES} entries`))
    return []
  }
  const out: ProviderCapabilityEvidence[] = []
  for (const [index, entry] of value.entries()) {
    const path = `profile.capabilities[${index}]`
    if (!isRecord(entry)) {
      errors.push(fail("invalid_type", path, "expected an object"))
      continue
    }
    const feature = entry.feature
    if (typeof feature !== "string" || feature.length === 0) {
      errors.push(fail("missing_field", `${path}.feature`, "a capability needs a feature name"))
      continue
    }
    const status = entry.status
    if (!(PROVIDER_CAPABILITY_STATUSES as readonly unknown[]).includes(status)) {
      errors.push(fail("unknown_capability_status", `${path}.status`, `expected one of ${PROVIDER_CAPABILITY_STATUSES.join(", ")}`))
      continue
    }
    out.push({
      feature,
      status: status as ProviderCapabilityStatus,
      checkedAt: typeof entry.checkedAt === "number" && Number.isFinite(entry.checkedAt) ? entry.checkedAt : undefined,
      detail: typeof entry.detail === "string" ? entry.detail.slice(0, 200) : undefined
    })
  }
  return out
}

/**
 * **解析并校验一份 profile**。
 *
 * `existing` 用来做两件事：**id / 名字重复检测**，以及**修订号递增**
 *（计划 Step 1 点名的 "duplicate names/IDs" 与 "profile revision increments"）。
 */
export function parseProviderProfile(input: unknown, existing: readonly ProviderProfile[] = []): ParseResult<ProviderProfile> {
  const errors: ReturnType<typeof fail>[] = []
  if (!isRecord(input)) return { ok: false, errors: [fail("invalid_type", "profile", "expected an object")] }

  // ---- 密钥字段：出现即拒绝（不是忽略） ----
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_SECRET_FIELDS.includes(key.toLowerCase())) {
      errors.push(fail("secret_not_allowed", `profile.${key}`, "a provider profile must never carry the secret itself; store it in the credential store and reference it with secretRef"))
    }
  }

  const id = typeof input.id === "string" ? input.id.trim() : ""
  if (id.length === 0) errors.push(fail("missing_field", "profile.id", "an id is required"))
  else if (id.length > MAX_ID_LENGTH) errors.push(fail("string_too_long", "profile.id", `max ${MAX_ID_LENGTH} characters`))

  const name = typeof input.name === "string" ? input.name.trim() : ""
  if (name.length === 0) errors.push(fail("missing_field", "profile.name", "a display name is required"))
  else if (name.length > MAX_NAME_LENGTH) errors.push(fail("string_too_long", "profile.name", `max ${MAX_NAME_LENGTH} characters`))

  /**
   * 协议 / 方言 / 网络策略：**先判"有没有"，再判"对不对"**。
   *
   * 第一版把两件事合成一条 `unknown_protocol`，于是漏填字段时报的是"协议不认识" ——
   * 那会让用户去翻协议列表，而他实际只是没选。**错误的错误信息比没有错误信息更费时间**，
   * 所以这里分成两条：缺字段是 `missing_field`，值不在闭集里才是 `unknown_*`。
   */
  const protocol = input.protocol
  if (protocol === undefined) errors.push(fail("missing_field", "profile.protocol", "a protocol is required"))
  else if (!(PROVIDER_PROTOCOLS as readonly unknown[]).includes(protocol)) {
    errors.push(fail("unknown_protocol", "profile.protocol", `expected one of ${PROVIDER_PROTOCOLS.join(", ")}`))
  }

  const dialect = input.dialect
  if (dialect === undefined) errors.push(fail("missing_field", "profile.dialect", "a dialect is required"))
  else if (!(PROVIDER_DIALECTS as readonly unknown[]).includes(dialect)) {
    errors.push(fail("unknown_dialect", "profile.dialect", `expected one of ${PROVIDER_DIALECTS.join(", ")}`))
  } else if ((PROVIDER_PROTOCOLS as readonly unknown[]).includes(protocol) && !DIALECTS_BY_PROTOCOL[protocol as ProviderProtocol].includes(dialect as ProviderDialect)) {
    // 协议与方言必须配套：`anthropic_messages` 配 `ollama` 是"选错了适配器"，
    // 而那种错在发请求时表现为 404 或 400，看起来像"服务坏了"。
    errors.push(fail("dialect_protocol_mismatch", "profile.dialect", `${String(dialect)} does not belong to ${String(protocol)}`))
  }

  const networkPolicy = input.networkPolicy
  if (networkPolicy === undefined) errors.push(fail("missing_field", "profile.networkPolicy", "a network policy is required"))
  else if (!(NETWORK_POLICIES as readonly unknown[]).includes(networkPolicy)) {
    errors.push(fail("unknown_network_policy", "profile.networkPolicy", `expected one of ${NETWORK_POLICIES.join(", ")}`))
  }

  // ---- Base URL ----
  let baseUrl = ""
  if (typeof input.baseUrl !== "string") {
    errors.push(fail("missing_field", "profile.baseUrl", "a base URL is required"))
  } else {
    const normalized = normalizeBaseUrl(input.baseUrl)
    if (!normalized.ok) {
      errors.push(fail("invalid_base_url", "profile.baseUrl", normalized.reason))
    } else {
      baseUrl = normalized.url
      /**
       * **HTTPS 规则**（计划 Step 1 点名的 "HTTPS rules"）。
       *
       * 非 `local` / `lan` 必须 HTTPS。反过来，`cloud` 策略下**私网地址一律拒绝** ——
       * 那是最常见的 SSRF 形状：让服务端去访问 `169.254.169.254` 拿云元数据。
       * 想连私网就得显式把策略改成 `lan` —— 那是**用户的选择**，不是默认放开。
       */
      const parsed = new URL(normalized.url)
      const host = parsed.hostname
      if (networkPolicy === "cloud") {
        if (parsed.protocol !== "https:") {
          errors.push(fail("https_required", "profile.baseUrl", "a cloud endpoint must use https; declare networkPolicy 'lan' or 'local' for a trusted private endpoint"))
        }
        if (isPrivateHost(host)) {
          errors.push(fail("private_address_denied", "profile.baseUrl", "a cloud profile must not point at a loopback or private address; declare networkPolicy 'lan' or 'local' if that is intended"))
        }
      }
    }
  }

  const modelId = typeof input.modelId === "string" ? input.modelId.trim() : ""
  if (modelId.length === 0) errors.push(fail("missing_field", "profile.modelId", "a model id is required"))
  else if (modelId.length > MAX_MODEL_ID_LENGTH) errors.push(fail("string_too_long", "profile.modelId", `max ${MAX_MODEL_ID_LENGTH} characters`))

  /**
   * `secretRef` 是**可选的引用**（指向凭据库里的条目名）。
   * 它允许缺省：用户可以先把 profile 建好、稍后再填密钥 —— 那时界面显示"未配置密钥"。
   */
  let secretRef: string | undefined
  if (input.secretRef !== undefined) {
    if (typeof input.secretRef !== "string" || input.secretRef.trim().length === 0) {
      errors.push(fail("invalid_type", "profile.secretRef", "secretRef must be a non-empty string when present"))
    } else {
      secretRef = input.secretRef.trim()
    }
  }

  const capabilities = readCapabilities(input.capabilities, errors)

  // ---- 重复检测与修订号 ----
  const current = existing.find((profile) => profile.id === id)
  if (!current && existing.some((profile) => profile.name === name && name.length > 0)) {
    errors.push(fail("duplicate_name", "profile.name", `another profile is already called ${name}`))
  }
  if (current && existing.some((profile) => profile.id !== id && profile.name === name)) {
    errors.push(fail("duplicate_name", "profile.name", `another profile is already called ${name}`))
  }

  if (errors.length > 0) return { ok: false, errors }

  /**
   * 修订号：新建从 1 开始，**更新则递增**。
   *
   * 为什么不让调用方传：修订号是"这份配置改过几次"的**事实**，由存储方数出来；
   * 让调用方传就会出现"改了两处但修订号没变"，而健康证据恰恰靠它判断新旧
   *（`ProviderHealth.profileRevision`）。
   */
  const revision = current ? current.revision + 1 : 1

  return {
    ok: true,
    value: {
      id,
      name,
      protocol: protocol as ProviderProtocol,
      dialect: dialect as ProviderDialect,
      baseUrl,
      modelId,
      secretRef,
      capabilities,
      networkPolicy: networkPolicy as NetworkPolicy,
      revision
    }
  }
}

/**
 * **写回之前的最后一道门**：确保要落盘的 profile 里没有密钥字段。
 *
 * 为什么在 `parseProviderProfile` 之外再来一次：那条路径负责"**收进来**的输入"，
 * 这条负责"**存下去**的对象"。两者之间会有别的代码（合并、从旧版本迁移、从文件导入），
 * 而"密钥落到磁盘上"这件事**只差一次疏忽**。它做的是**结构检查**而不是字符串扫描。
 */
export function containsSecretField(value: unknown, depth = 0): boolean {
  if (depth > 6 || !isRecord(value)) return false
  return Object.entries(value).some(([key, child]) => {
    const lowered = key.toLowerCase()
    // `secretRef` 是允许的：它装的是条目名。
    if (lowered !== "secretref" && FORBIDDEN_SECRET_FIELDS.includes(lowered)) return true
    return containsSecretField(child, depth + 1)
  })
}

/**
 * **能力证据能不能被采信**（Task 1.4 Step 5）。
 *
 * 两条判据：
 * 1. `verified` 才作数 —— `declared` 是"文档里说支持"，不是"我们验过"；
 * 2. 证据必须属于**当前修订号** —— 配置改过之后，旧证据可能已经无效。
 */
export function isCapabilityVerified(evidence: readonly ProviderCapabilityEvidence[], feature: string, profileRevision: number, health: ProviderHealth | undefined): boolean {
  if (!health || health.profileRevision !== profileRevision) return false
  const fromHealth = health.capabilityEvidence.find((entry) => entry.feature === feature)
  if (fromHealth) return fromHealth.status === "verified"
  return evidence.some((entry) => entry.feature === feature && entry.status === "verified")
}
