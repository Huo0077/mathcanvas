/**
 * **Provider 配置客户端**（Task 1.3 Step 3/4 的前端那一半）。
 *
 * 与 `secretClient.ts` 同一套口径：
 * - **在浏览器里跑是正常状态**（`no_desktop_shell`），不是错误；
 * - **IPC 失败要给原因**（`ipc_failed`），与"没有桌面外壳"分开；
 * - **密钥字段一个都不许过**：这里在发 IPC **之前**就把带密钥形状的对象拦下来 ——
 *   Rust 侧也会拦（`prepare_profile`），但那时候用户已经看到一次失败，
 *   而界面本可以先说"这个字段不该出现在配置里"。
 */

import { invokeDesktop, NoDesktopShellError } from "./desktopRuntime"

export type ProviderProtocol = "openai_compatible" | "anthropic" | "ollama"
export type ProviderDialect = "openai_native" | "deepseek" | "moonshot" | "generic_compatible" | "anthropic_messages" | "ollama_native"
export type NetworkPolicy = "cloud" | "lan" | "local"
export type CapabilityStatus = "unknown" | "declared" | "verified" | "failed"

export interface CapabilityEvidence {
  feature: string
  status: CapabilityStatus
  checkedAt?: number
  detail?: string
}

export interface ProviderProfile {
  id: string
  name: string
  protocol: ProviderProtocol
  dialect: ProviderDialect
  baseUrl: string
  modelId: string
  /** **只有引用**：真正的密钥在系统凭据库里。 */
  secretRef?: string
  capabilities: CapabilityEvidence[]
  networkPolicy: NetworkPolicy
  revision: number
}

export interface ProviderHealth {
  status: "unknown" | "ok" | "degraded" | "failed"
  latencyMs?: number
  capabilityEvidence: CapabilityEvidence[]
  checkedAt: number
  profileRevision: number
}

export type ProviderResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "no_desktop_shell"; detail: string }
  | { ok: false; code: "ipc_failed"; detail: string }
  | { ok: false; code: "secret_not_allowed"; detail: string }

/** 与 Rust 侧 `FORBIDDEN_SECRET_FIELDS` 同一份判据（两处都要有：入口与出口）。 */
const FORBIDDEN_SECRET_FIELDS = ["secret", "secretvalue", "secret_value", "apikey", "api_key", "key", "token", "password", "credential"]

/**
 * 找出对象里第一个密钥形状的字段名（任意深度）。`secretRef` 是引用，放行。
 *
 * **数组也要进去**（外部审查 M9）：原先的 `Array.isArray(value) → null` 让数组成为盲区，
 * 于是 `{"capabilities":[{"apiKey":"sk-…"}]}` 这种载荷**不会被拒**，而是被反序列化**静默削掉**
 *（`CapabilityEvidence` 没有 `deny_unknown_fields`）—— 正是注释里说"比报错更危险"的那种结果。
 * 函数自己的文档写着"任意深度"，数组也是深度。Rust 侧同一处也一起修了。
 */
export function findSecretField(value: unknown, depth = 0): string | null {
  if (depth > 6 || !value || typeof value !== "object") return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findSecretField(item, depth + 1)
      if (nested) return nested
    }
    return null
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase()
    if (lowered !== "secretref" && FORBIDDEN_SECRET_FIELDS.includes(lowered)) return key
    const nested = findSecretField(child, depth + 1)
    if (nested) return nested
  }
  return null
}

function asResult<T>(error: unknown): ProviderResult<T> {
  if (error instanceof NoDesktopShellError) return { ok: false, code: "no_desktop_shell", detail: error.message }
  return { ok: false, code: "ipc_failed", detail: error instanceof Error ? error.message : String(error) }
}

export async function listProviderProfiles(): Promise<ProviderResult<ProviderProfile[]>> {
  try {
    const raw = await invokeDesktop<unknown>("list_provider_profiles")
    return { ok: true, value: Array.isArray(raw) ? (raw as ProviderProfile[]) : [] }
  } catch (error) {
    return asResult(error)
  }
}

/**
 * 新增或更新一份配置。
 *
 * `expectedRevision` 是**乐观并发**：两个设置窗口同时开着时，后写的会拿到错误，
 * 而不是把前一个的改动覆盖掉（`undefined` = 明确表示"这是一次新建/强制覆盖"）。
 */
export async function upsertProviderProfile(profile: Record<string, unknown>, expectedRevision?: number): Promise<ProviderResult<ProviderProfile>> {
  // 发 IPC **之前**先拦密钥字段：否则用户看到的是"保存失败"，而真正的原因是
  // "这个字段根本不该出现在配置里"。
  const secretField = findSecretField(profile)
  if (secretField) {
    return { ok: false, code: "secret_not_allowed", detail: `a provider profile must not carry \`${secretField}\`; use the credential store and set secretRef instead` }
  }

  try {
    const raw = await invokeDesktop<ProviderProfile>("upsert_provider_profile", { profile, expectedRevision })
    return { ok: true, value: raw }
  } catch (error) {
    return asResult(error)
  }
}

export async function removeProviderProfile(profileId: string): Promise<ProviderResult<void>> {
  try {
    await invokeDesktop("remove_provider_profile", { profileId })
    return { ok: true, value: undefined }
  } catch (error) {
    return asResult(error)
  }
}

export async function readProviderHealth(profileId: string): Promise<ProviderResult<ProviderHealth | null>> {
  try {
    const raw = await invokeDesktop<unknown>("provider_health", { profileId })
    return { ok: true, value: (raw ?? null) as ProviderHealth | null }
  } catch (error) {
    return asResult(error)
  }
}

/**
 * **失败合同**：Rust 侧把命令的 `Err` 做成 `ModelEvent` 的 `failed` 形状
 * （`kind` / `failure` / `message` / `retryable`），但 Tauri 把它作为**字符串**交过来。
 * 所以这里要解析一次 —— 而不是把那个字符串直接显示给用户（那会显示一坨 JSON）。
 *
 * 解析不出来时回 `null`：调用方退回 `asResult` 的通用处理，而不是假装读懂了一份 JSON。
 */
export function readFailureContract(error: unknown): { failure: string; message: string; retryable: boolean } | null {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  const start = text.indexOf("{")
  if (start < 0) return null
  try {
    const parsed = JSON.parse(text.slice(start)) as { kind?: unknown; failure?: unknown; message?: unknown; retryable?: unknown }
    if (parsed.kind !== "failed" || typeof parsed.message !== "string") return null
    return {
      failure: typeof parsed.failure === "string" ? parsed.failure : "unknown",
      message: parsed.message,
      retryable: parsed.retryable === true
    }
  } catch {
    return null
  }
}

/**
 * **切换当前使用的模型服务**（Task 1.3 Step 5）。
 *
 * 只动一个字段，不改任何 profile —— 这一点值得写在这里，因为"切换模型"听起来
 * 像是要改配置，而它不该：能力证据挂在修订号上，切换顺带推高修订号会让四个
 * 徽章在每次切换后全部变回"未验证"。
 */
export async function selectProviderProfile(profileId: string): Promise<ProviderResult<string>> {
  try {
    const raw = await invokeDesktop<string>("select_provider_profile", { profileId })
    return { ok: true, value: raw }
  } catch (error) {
    return asResult(error)
  }
}

/** 现在在用哪一份配置。`null` 表示**还没选过**（不是"选了第一份"）。 */
export async function readActiveProviderProfile(): Promise<ProviderResult<string | null>> {
  try {
    const raw = await invokeDesktop<unknown>("active_provider_profile")
    return { ok: true, value: typeof raw === "string" && raw.length > 0 ? raw : null }
  } catch (error) {
    return asResult(error)
  }
}

/**
 * **跑一次能力探测**（Task 1.4 Step 5）。
 *
 * ## 它会真的花掉四发请求
 *
 * 文本、JSON、一张 1×1 的 PNG、一次带工具表的请求。所以它**只能由用户按下去**，
 * 不能在打开设置时自动跑 —— 那会悄悄花掉别人的额度。界面上的按钮要写明这一点。
 *
 * ## 与 `readProviderHealth` 的分工
 *
 * 这一个**发请求并改状态**；那一个只读已经存下来的结论。分开是因为两者的代价差得远：
 * 读是零成本、随时可以做；探测要花钱、要等。
 */
export async function checkProviderCapabilities(profileId: string, profileRevision: number): Promise<ProviderResult<ProviderHealth>> {
  try {
    const raw = await invokeDesktop<ProviderHealth>("provider_check", { profileId, profileRevision })
    return { ok: true, value: raw }
  } catch (error) {
    return asResult(error)
  }
}

/**
 * **能不能采信某个能力**（Task 1.4 Step 5）。
 *
 * 两条判据，缺一不可：`verified` 才作数（`declared` 是"文档里说支持"），
 * 且证据必须属于**当前修订号**（配置改过之后旧证据可能已经无效）。
 * 前端的这份与 `agent-core` 的同名函数是同一条规则 —— 界面要靠它显示"未验证"徽章。
 */
export function isVerified(profile: ProviderProfile, feature: string, health: ProviderHealth | null): boolean {
  if (!health || health.profileRevision !== profile.revision) return false
  const fromHealth = health.capabilityEvidence.find((entry) => entry.feature === feature)
  if (fromHealth) return fromHealth.status === "verified"
  return profile.capabilities.some((entry) => entry.feature === feature && entry.status === "verified")
}

/**
 * **保存一份配置，并（可选）把密钥写进凭据库**。
 *
 * ## 为什么这一步要单独有一个函数，而不是让界面自己调两次
 *
 * 因为**顺序**是有意义的，而且错一次就会留下不一致：
 * 1. 先把密钥写进凭据库 —— 失败就**不动配置**（否则会出现"配置指向一个不存在的密钥"，
 *    界面显示已配置、请求却拿不到密钥）；
 * 2. 再写配置，`secretRef` 指向刚存进去的条目；
 * 3. **配置写失败要回滚密钥** —— 否则凭据库里留下一个没人引用的孤儿条目
 *    （用户看不到它，但它确实占着一格）。
 *
 * 把这三步放在一个函数里，"顺序"与"回滚"就只有一处实现；放在界面里，
 * 每个调用点都要自己想一遍，而漏掉回滚的那一次没人会发现。
 */
export async function saveProfileWithSecret(
  profile: Record<string, unknown>,
  options: { secret?: string; expectedRevision?: number } = {}
): Promise<{ ok: true; profile: ProviderProfile; secretSaved: boolean } | { ok: false; code: string; detail: string }> {
  // 动态导入：`secretClient` 会用到同一个 IPC 入口，静态导入在这里没有额外好处，
  // 而动态导入让本模块的**纯函数部分**（例如 `findSecretField`）可以在不加载它的情况下被测试。
  const { saveSecret, removeSecret } = await import("./secretClient")
  const profileId = typeof profile.id === "string" ? profile.id : ""
  const secret = options.secret ?? ""
  let secretSaved = false

  if (secret.length > 0) {
    const saved = await saveSecret(profileId, secret)
    if (!saved.ok) return { ok: false, code: saved.code === "no_desktop_shell" ? "no_desktop_shell" : "secret_failed", detail: saved.detail }
    secretSaved = true
  }

  const written = await upsertProviderProfile(profile, options.expectedRevision)
  if (!written.ok) {
    // 回滚：配置没写成功，刚存进去的密钥就是孤儿。
    if (secretSaved) await removeSecret(profileId)
    return { ok: false, code: written.code, detail: written.detail }
  }

  return { ok: true, profile: written.value, secretSaved }
}
